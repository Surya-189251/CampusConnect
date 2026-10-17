const express=require('express'),pool=require('./db');const {requireAuth,requireRole}=require('./auth');const {rateLimit}=require('express-rate-limit');
const {fail,id,text,wrap,transaction,audit,errors}=require('./campus-utils');
const router=express.Router();router.use(requireAuth,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
const uuid=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v))throw fail(400,'Invalid request reference. Reload and try again.');return v;};
const statuses=['open','in_progress','resolved','closed'];
const reference=t=>({...t,reference:'CC-SUP-'+String(t.id).padStart(6,'0')});
const limiter=rateLimit({windowMs:15*60*1000,limit:30,keyGenerator:req=>String(req.user.id),standardHeaders:true,legacyHeaders:false,message:{message:'Too many support updates. Try again in 15 minutes.'}});
async function active(db,user){if(!(await db.query("SELECT id FROM users WHERE id=$1 AND college_id=$2 AND status='approved' AND must_change_password=FALSE FOR UPDATE",[user.id,user.college_id])).rowCount)throw fail(403,'Your account changed. Sign in again.');}
async function ticket(db,req,lock=false){const r=await db.query(`SELECT t.*,u.full_name AS reporter_name,u.login_id AS reporter_login,u.role AS reporter_role
 FROM support_tickets t JOIN users u ON u.id=t.reporter_id WHERE t.id=$1 AND t.college_id=$2 AND ($3='admin' OR t.reporter_id=$4) ${lock?'FOR UPDATE OF t':''}`,[id(req.params.id),req.user.college_id,req.user.role,req.user.id]);if(!r.rowCount)throw fail(404,'Support request not found.');return r.rows[0];}
router.get('/',wrap(async(req,res)=>{
 const state=req.query.status||'all';if(state!=='all'&&!statuses.includes(state))throw fail(400,'Choose a valid status.');const before=req.query.before?id(req.query.before):2147483647;const search=typeof req.query.search==='string'?req.query.search.trim().slice(0,100):'';
 const r=await pool.query(`SELECT t.id,t.title,t.category,t.status,t.priority,t.version,t.created_at,t.updated_at,u.full_name AS reporter_name,u.role AS reporter_role
 FROM support_tickets t JOIN users u ON u.id=t.reporter_id WHERE t.college_id=$1 AND ($2='admin' OR t.reporter_id=$3)
 AND ($4='all' OR t.status=$4) AND t.id<$5 AND ($6='' OR STRPOS(LOWER(t.title||' CC-SUP-'||LPAD(t.id::text,6,'0')),LOWER($6))>0) ORDER BY t.id DESC LIMIT 51`,[req.user.college_id,req.user.role,req.user.id,state,before,search]);
 const counts=await pool.query(`SELECT status,COUNT(*)::integer AS count FROM support_tickets WHERE college_id=$1 AND ($2='admin' OR reporter_id=$3) GROUP BY status`,[req.user.college_id,req.user.role,req.user.id]);
 res.json({tickets:r.rows.slice(0,50).map(reference),counts:Object.fromEntries(counts.rows.map(r=>[r.status,r.count])),nextCursor:r.rows.length>50?r.rows[49].id:null});
}));
router.post('/',requireRole('student','faculty'),limiter,wrap(async(req,res)=>{
 const b=req.body||{},title=text(b.title,160,'Subject'),description=text(b.description,5000,'Description'),key=uuid(b.requestKey);
 if(!['attendance','marks','fees','account','facilities','other'].includes(b.category)||!['low','normal','high'].includes(b.priority))throw fail(400,'Choose a valid category and priority.');
 const t=await transaction(async db=>{await active(db,req.user);const old=(await db.query('SELECT * FROM support_tickets WHERE reporter_id=$1 AND request_key=$2',[req.user.id,key])).rows[0];
 if(old){if(old.title!==title||old.description!==description||old.category!==b.category||old.priority!==b.priority)throw fail(409,'This submission reference was already used. Check your requests before submitting again.');return old;}
 const r=await db.query('INSERT INTO support_tickets(college_id,reporter_id,title,description,category,priority,request_key) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[req.user.college_id,req.user.id,title,description,b.category,b.priority,key]);await audit(db,req.user,'support.created','support',r.rows[0].id,{category:b.category});return r.rows[0];});
 res.status(201).json({ticket:reference(t),message:'Request submitted to your college admin.'});
}));
router.get('/:id',wrap(async(req,res)=>{const t=await ticket(pool,req);const messages=await pool.query(`SELECT m.id,m.body,m.status_after,m.created_at,u.full_name AS author_name,u.role AS author_role FROM support_messages m JOIN users u ON u.id=m.author_id WHERE m.ticket_id=$1 ORDER BY m.id`,[t.id]);res.json({ticket:reference(t),messages:messages.rows});}));
router.post('/:id/messages',limiter,wrap(async(req,res)=>{
 const b=req.body||{},body=text(b.body,3000,'Reply'),key=uuid(b.requestKey),version=id(b.version);let action=b.action||'reply';if(!['reply','reopen'].includes(action))throw fail(400,'Invalid support action.');
 const result=await transaction(async db=>{await active(db,req.user);const t=await ticket(db,req,true);
 const old=(await db.query('SELECT ticket_id,body,status_after FROM support_messages WHERE author_id=$1 AND request_key=$2',[req.user.id,key])).rows[0];
 if(old){if(old.ticket_id!==t.id||old.body!==body||old.status_after!==(req.user.role==='admin'?b.status:action==='reopen'?'open':old.status_after))throw fail(409,'Reply reference already used. Refresh the conversation.');return t;}
 if(t.version!==version)throw fail(409,'This request was updated elsewhere. Refresh before replying.');let next=t.status;
 if(req.user.role==='admin'){if(!statuses.includes(b.status))throw fail(400,'Choose a valid status.');next=b.status;}
 else if(action==='reopen'){if(!['resolved','closed'].includes(t.status))throw fail(409,'Only resolved or closed requests can be reopened.');next='open';}
 else if(['resolved','closed'].includes(t.status))throw fail(409,'Reopen this request to add a follow-up.');
 await db.query('INSERT INTO support_messages(ticket_id,author_id,body,status_after,request_key) VALUES($1,$2,$3,$4,$5)',[t.id,req.user.id,body,next,key]);
 const updated=(await db.query('UPDATE support_tickets SET status=$1,version=version+1,updated_at=NOW() WHERE id=$2 RETURNING *',[next,t.id])).rows[0];await audit(db,req.user,'support.replied','support',t.id,{status:next});return updated;
 });res.json({ticket:reference(result),message:'Reply saved.'});
}));router.use(errors);module.exports=router;
