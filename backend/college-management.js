const express=require('express'),crypto=require('node:crypto'),bcrypt=require('bcryptjs'),pool=require('./db');
const {rateLimit}=require('express-rate-limit');const {requireAuth,requireRole}=require('./auth');
const {fail,id,text,wrap,transaction,demand,collegeLock,audit,errors}=require('./campus-utils');
const router=express.Router();router.use(requireAuth,requireRole('admin'),(req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/',wrap(async(req,res)=>{const c=(await pool.query('SELECT id,code,name FROM colleges WHERE id=$1',[req.user.college_id])).rows[0];
 const admins=await pool.query("SELECT login_id,full_name,email FROM users WHERE college_id=$1 AND role='admin' AND status='approved'",[req.user.college_id]);res.json({college:c,admin:admins.rows[0]});}));
router.patch('/',wrap(async(req,res)=>{const name=text(req.body?.name,200,'College name');await transaction(async db=>{
 await collegeLock(db,req.user.college_id);await demand(db,req.user,null);await db.query('UPDATE colleges SET name=$1 WHERE id=$2',[name,req.user.college_id]);await audit(db,req.user,'college.renamed','college',req.user.college_id,{name});});res.json({message:'College name updated. Refresh the page to update the login banner.'});}));
router.get('/faculty',wrap(async(req,res)=>{
 const search=typeof req.query.search==='string'?req.query.search.trim().slice(0,100):'';
 const r=await pool.query(`SELECT u.id,u.login_id,u.full_name,u.email,u.status,u.must_change_password,u.updated_at::text,p.department,p.approved_designation,
 (SELECT COUNT(*)::integer FROM academic_courses c WHERE c.faculty_id=u.id AND c.college_id=$1) AS assigned_courses
 FROM users u LEFT JOIN faculty_profiles p ON p.user_id=u.id WHERE u.college_id=$1 AND u.role='faculty' AND u.status IN ('approved','disabled')
 AND ($2='' OR STRPOS(LOWER(u.login_id||' '||u.full_name),LOWER($2))>0) ORDER BY u.full_name,u.id LIMIT 201`,[req.user.college_id,search]);res.json({faculty:r.rows.slice(0,200),truncated:r.rows.length>200});
}));
const limiter=rateLimit({windowMs:15*60*1000,limit:30,keyGenerator:req=>String(req.user.id),standardHeaders:true,legacyHeaders:false,message:{message:'Too many account changes. Try again in 15 minutes.'}});
router.post('/faculty/:id/action',limiter,wrap(async(req,res)=>{
 const target=id(req.params.id),action=req.body?.action,reason=text(req.body?.reason,500,'Reason');
 if(!['disable','enable','reset-password'].includes(action))throw fail(400,'Choose a valid faculty account action.');
 if(typeof req.body?.expectedUpdatedAt!=='string')throw fail(400,'Refresh the account list first.');
 const temporaryPassword=action==='reset-password'?crypto.randomBytes(18).toString('base64url'):null;
 const hash=temporaryPassword?await bcrypt.hash(temporaryPassword,12):null;
 await transaction(async db=>{await collegeLock(db,req.user.college_id);await demand(db,req.user,null);
 const u=(await db.query("SELECT id,status,updated_at::text FROM users WHERE id=$1 AND college_id=$2 AND role='faculty' AND status IN ('approved','disabled') FOR UPDATE",[target,req.user.college_id])).rows[0];if(!u)throw fail(404,'Faculty account not found in your college.');
 if(u.updated_at!==req.body.expectedUpdatedAt)throw fail(409,'Account changed elsewhere. Refresh before trying again.');
 if(action==='reset-password'&&u.status!=='approved')throw fail(409,'Re-enable the faculty account before resetting its password.');
 if(action==='disable'&&u.status!=='approved'||action==='enable'&&u.status!=='disabled')throw fail(409,'Account status already changed. Refresh the list.');
 if(action==='reset-password')await db.query('UPDATE users SET password_hash=$1,must_change_password=TRUE,updated_at=NOW() WHERE id=$2',[hash,target]);
 else await db.query('UPDATE users SET status=$1,updated_at=NOW() WHERE id=$2',[action==='disable'?'disabled':'approved',target]);
 // Re-enabling does not restore earlier sessions or privileged grants.
 if(action==='disable')await db.query('DELETE FROM user_permissions WHERE user_id=$1',[target]);
 await db.query('DELETE FROM sessions WHERE user_id=$1',[target]);await audit(db,req.user,'faculty.'+action,'user',target,{reason,previousStatus:u.status});
 });res.json({message:action==='reset-password'?'Password reset. Share the temporary password privately; the faculty member must change it at login.':action==='disable'?'Faculty disabled, sessions ended and optional permissions removed. Course assignments were retained.':'Faculty enabled. Reassign optional permissions if required.',...(temporaryPassword?{temporaryPassword}:{})});
}));
router.get('/audit',wrap(async(req,res)=>{
 const before=req.query.before?String(req.query.before):null;if(before&&!/^\d{1,19}$/.test(before))throw fail(400,'Invalid page cursor.');
 const result=await pool.query(`SELECT a.id::text,a.action,a.target_type,a.target_id,a.details,a.created_at::text,u.full_name AS actor_name
 FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id
 WHERE (a.details->>'collegeId'=$1::text OR (NOT(a.details ? 'collegeId') AND u.college_id=$1::integer)) AND ($2::bigint IS NULL OR a.id<$2::bigint)
 ORDER BY a.id DESC LIMIT 51`,[req.user.college_id,before]);const rows=result.rows.slice(0,50);res.json({events:rows,nextCursor:result.rows.length>50?rows[rows.length-1].id:null});
}));router.use(errors);module.exports=router;
