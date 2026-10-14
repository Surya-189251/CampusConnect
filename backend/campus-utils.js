const pool=require('./db');
const fail=(status,message)=>Object.assign(new Error(message),{status});
const id=v=>{const n=Number(v);if(!Number.isInteger(n)||n<1||n>2147483647)throw fail(400,'Invalid record ID or version.');return n;};
const text=(v,max,label)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)throw fail(400,`${label} is required (maximum ${max} characters).`);return v.trim();};
function date(v){if(typeof v!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw fail(400,'Use a valid date between 2000 and 2099.');return v;}
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}};
async function transaction(fn){const db=await pool.connect();try{await db.query('BEGIN');const r=await fn(db);await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}}
async function allowed(db,user,permission,lock=false){
 const r=await db.query(`SELECT role FROM users WHERE id=$1 AND college_id=$2 AND status='approved' AND must_change_password=FALSE ${lock?'FOR UPDATE':''}`,[user.id,user.college_id]);
 if(r.rows[0]?.role==='admin')return true;
 if(r.rows[0]?.role!=='faculty'||!permission)return false;
 return (await db.query('SELECT 1 FROM user_permissions WHERE user_id=$1 AND permission_code=$2',[user.id,permission])).rowCount>0;
}
async function demand(db,user,permission,lock=true){if(!await allowed(db,user,permission,lock))throw fail(403,'Your account does not have permission for this action.');}
async function collegeLock(db,collegeId){const r=await db.query('SELECT id FROM colleges WHERE id=$1 AND is_active=TRUE FOR UPDATE',[collegeId]);if(!r.rowCount)throw fail(403,'College is inactive.');}
async function audit(db,user,action,type,target,details={}){await db.query('INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,details) VALUES($1,$2,$3,$4,$5::jsonb)',[user?.id||null,action,type,String(target),JSON.stringify({...details,collegeId:user.college_id})]);}
function errors(e,req,res,next){if(e.status)return res.status(e.status).json({message:e.message});if(e.code==='23505')return res.status(409).json({message:'A matching record already exists. Refresh and check the existing record.'});next(e);}
module.exports={fail,id,text,date,wrap,transaction,allowed,demand,collegeLock,audit,errors};
