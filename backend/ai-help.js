const express=require('express'),crypto=require('node:crypto'),pool=require('./db');
const {rateLimit}=require('express-rate-limit'),{requireAuth}=require('./auth'),{fail,wrap,transaction,errors}=require('./campus-utils');
const provider=require('./ai-provider'),{instructions}=require('./ai-prompts');
const router=express.Router();router.use(requireAuth,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
function limit(name,d,max){const n=Number(process.env[name]);return Number.isInteger(n)&&n>=1&&n<=max?n:d;}
function config(){return {enabled:process.env.OPENAI_ENABLED==='true'&&Boolean(provider.settings().key),model:provider.settings().model,userLimit:limit('AI_DAILY_USER_LIMIT',20,200),collegeLimit:limit('AI_DAILY_COLLEGE_LIMIT',100,10000),globalLimit:limit('AI_DAILY_GLOBAL_LIMIT',300,20000)};}
function uuid(v){if(typeof v!=='string'||!(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i).test(v))throw fail(400,'Invalid chat or request ID.');return v;}
async function owned(db,user,id,lock=false){const r=await db.query(`SELECT * FROM ai_conversations WHERE id=$1 AND user_id=$2 AND college_id=$3 ${lock?'FOR UPDATE':''}`,[uuid(id),user.id,user.college_id]);if(!r.rowCount)throw fail(404,'Chat not found.');return r.rows[0];}
router.get('/config',wrap(async(req,res)=>{const c=config(),r=await pool.query("SELECT requests FROM ai_usage_daily WHERE scope='user' AND scope_id=$1 AND day=(NOW() AT TIME ZONE 'UTC')::date",[req.user.id]);res.json({enabled:c.enabled,dailyLimit:c.userLimit,used:r.rows[0]?.requests||0,maxMessageLength:3000});}));
router.get('/conversations',wrap(async(req,res)=>{const mode=req.query.mode;if(!['study','support'].includes(mode))throw fail(400,'Choose a chat mode.');const r=await pool.query('SELECT id,mode,title,created_at,updated_at FROM ai_conversations WHERE user_id=$1 AND college_id=$2 AND mode=$3 ORDER BY updated_at DESC,id',[req.user.id,req.user.college_id,mode]);res.json({conversations:r.rows});}));
router.post('/conversations',wrap(async(req,res)=>{const mode=req.body?.mode;if(!['study','support'].includes(mode))throw fail(400,'Choose a chat mode.');const id=uuid(req.body?.id);const result=await transaction(async db=>{
 await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[req.user.id]);
 const existing=await db.query('SELECT * FROM ai_conversations WHERE id=$1',[id]);if(existing.rowCount){const c=await owned(db,req.user,id);if(c.mode!==mode)throw fail(409,'Chat ID already used.');return c;}
 const n=(await db.query('SELECT COUNT(*)::integer AS n FROM ai_conversations WHERE user_id=$1',[req.user.id])).rows[0].n;if(n>=100)throw fail(409,'You have 100 saved chats. Delete old chats before creating more.');
 return (await db.query('INSERT INTO ai_conversations(id,user_id,college_id,mode) VALUES($1,$2,$3,$4) RETURNING *',[id,req.user.id,req.user.college_id,mode])).rows[0];});res.status(201).json({conversation:result});}));
router.get('/conversations/:id',wrap(async(req,res)=>{const conversation=await owned(pool,req.user,req.params.id);const turns=(await pool.query('SELECT id,request_key,prompt,answer,status,error,incomplete,created_at,updated_at FROM ai_turns WHERE conversation_id=$1 ORDER BY id',[conversation.id])).rows;res.json({conversation,turns});}));
router.patch('/conversations/:id',wrap(async(req,res)=>{const title=req.body?.title?.trim();if(!title||title.length>120)throw fail(400,'Use a chat name of 1–120 characters.');await transaction(async db=>{await owned(db,req.user,req.params.id,true);await db.query('UPDATE ai_conversations SET title=$1,updated_at=NOW() WHERE id=$2',[title,req.params.id]);});res.json({message:'Chat renamed.'});}));
router.delete('/conversations/:id',wrap(async(req,res)=>{await transaction(async db=>{await owned(db,req.user,req.params.id,true);await db.query('DELETE FROM ai_conversations WHERE id=$1',[req.params.id]);});res.json({message:'Chat deleted.'});}));
async function reserve(db,user,c){
 const account=await db.query("SELECT id FROM users WHERE id=$1 AND college_id=$2 AND status='approved' AND must_change_password=FALSE FOR UPDATE",[user.id,user.college_id]);if(!account.rowCount)throw fail(403,'Account changed. Sign in again.');
 for(const [scope,scopeId,cap] of [['global',0,c.globalLimit],['college',user.college_id,c.collegeLimit],['user',user.id,c.userLimit]]){
 const r=await db.query(`INSERT INTO ai_usage_daily(scope,scope_id,day,requests) VALUES($1,$2,(NOW() AT TIME ZONE 'UTC')::date,1)
 ON CONFLICT(scope,scope_id,day) DO UPDATE SET requests=ai_usage_daily.requests+1 WHERE ai_usage_daily.requests<$3 RETURNING requests`,[scope,scopeId,cap]);
 if(!r.rowCount)throw fail(429,scope==='user'?'Your daily AI message limit is reached. It resets at 00:00 UTC.':'The shared daily AI allowance is reached. Please try after 00:00 UTC. Support requests still work.');
 }
}
const limiter=rateLimit({windowMs:60*1000,limit:5,keyGenerator:req=>String(req.user.id),standardHeaders:true,legacyHeaders:false,message:{message:'Please wait a minute before sending more AI messages.'}});
router.post('/chat',limiter,wrap(async(req,res)=>{
 const c=config(),b=req.body||{};if(!c.enabled)throw fail(503,'AI is not enabled. The server owner must configure OPENAI_ENABLED and the API key.');
 if (
  b.consent !== true ||
  b.consentVersion !== "multi-provider-v1"
) {
  throw fail(
    400,
    "Refresh the page and accept the updated AI data notice."
  );
}
 const conversationId=uuid(b.conversationId),requestKey=uuid(b.requestKey),message=typeof b.message==='string'?b.message.trim():'';
 if(!message||message.length>3000)throw fail(400,'Enter 1–3000 characters.');
 const prepared=await transaction(async db=>{
 const conversation=await owned(db,req.user,conversationId,true);
 const previous=(await db.query('SELECT * FROM ai_turns WHERE conversation_id=$1 AND request_key=$2',[conversationId,requestKey])).rows[0];
 if(previous&&previous.prompt!==message)throw fail(409,'Request ID already used for a different message.');
 if(previous?.status==='complete')return {cached:true,answer:previous.answer,incomplete:previous.incomplete,conversation};
 const pending=await db.query("SELECT id FROM ai_turns WHERE conversation_id=$1 AND status='pending' AND updated_at>NOW()-INTERVAL '90 seconds'",[conversationId]);if(pending.rowCount)throw fail(409,'This chat has a response in progress. Refresh in a moment.');
 await db.query("UPDATE ai_turns SET status='failed',error='The previous request was interrupted. Retry your question.',updated_at=NOW() WHERE conversation_id=$1 AND status='pending'",[conversationId]);
 const count=(await db.query('SELECT COUNT(*)::integer AS n FROM ai_turns WHERE conversation_id=$1',[conversationId])).rows[0].n;if(!previous&&count>=250)throw fail(409,'This chat is full. Start a new chat.');
 await reserve(db,req.user,c);
 const history=(await db.query("SELECT prompt,answer FROM ai_turns WHERE conversation_id=$1 AND status='complete' ORDER BY id DESC LIMIT 4",[conversationId])).rows.reverse();
 let messages=history.flatMap(t=>[{role:'user',content:t.prompt},{role:'assistant',content:t.answer.slice(0,3000)}]);messages.push({role:'user',content:message});while(messages.length>1&&messages.reduce((n,m)=>n+m.content.length,0)>15000)messages=messages.slice(2);
 const turn=(await db.query(`INSERT INTO ai_turns(conversation_id,request_key,prompt,status) VALUES($1,$2,$3,'pending') ON CONFLICT(conversation_id,request_key) DO UPDATE SET status='pending',error=NULL,updated_at=NOW() RETURNING id`,[conversationId,requestKey,message])).rows[0];
 await db.query("UPDATE ai_conversations SET title=CASE WHEN title='New chat' THEN $1 ELSE title END,updated_at=NOW() WHERE id=$2",[message.slice(0,120),conversationId]);return {conversation,messages,turnId:turn.id};
 });
 if(prepared.cached)return res.json({answer:prepared.answer,incomplete:prepared.incomplete,conversationId});
 try{const output=await provider.answer(instructions(prepared.conversation.mode,req.user.role),prepared.messages);
 await pool.query("UPDATE ai_turns SET status='complete',answer=$1,incomplete=$2,error=NULL,updated_at=NOW() WHERE id=$3 AND status='pending'",[output.answer,output.incomplete,prepared.turnId]);res.json({...output,conversationId});
 }catch(e){await pool.query("UPDATE ai_turns SET status='failed',error=$1,updated_at=NOW() WHERE id=$2 AND status='pending'",[e.status?e.message:'AI could not respond. Retry later.',prepared.turnId]);throw e;}
}));
router.use(errors);module.exports={router,config};
