const express=require('express'),pool=require('./db');
const {requireAuth}=require('./auth');
const {fail,id,text,wrap,transaction,allowed,demand,collegeLock,audit,errors}=require('./campus-utils');
const router=express.Router();router.use(requireAuth,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
// Department and role targets are evaluated using the signed-in account, never client claims.
const visibility=`n.status='published' AND n.publish_at<=NOW() AND (n.expires_at IS NULL OR n.expires_at>NOW())
 AND ($3='admin' OR ((n.audience='all' OR n.audience=CASE WHEN $3='student' THEN 'students' ELSE 'faculty' END)
 AND (n.department='' OR LOWER(n.department)=LOWER(COALESCE((SELECT department FROM student_profiles WHERE user_id=$2),(SELECT department FROM faculty_profiles WHERE user_id=$2),'')))))`;
function stamp(v,label){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(v)||!Number.isFinite(Date.parse(v)))throw fail(400,`Choose a valid ${label}.`);return new Date(v).toISOString();}
function form(b){const title=text(b.title,160,'Title'),body=text(b.body,5000,'Notice text');if(!['all','students','faculty'].includes(b.audience)||!['draft','published','archived'].includes(b.status)||typeof b.pinned!=='boolean')throw fail(400,'Select a valid audience, status and pin setting.');
 const department=b.department===''?'':text(b.department,100,'Department');const publishAt=stamp(b.publishAt,'publish time'),expiresAt=b.expiresAt?stamp(b.expiresAt,'expiry time'):null;if(expiresAt&&expiresAt<=publishAt)throw fail(400,'Expiry must be after publication.');return [title,body,b.audience,department,b.pinned,b.status,publishAt,expiresAt];}
router.get('/',wrap(async(req,res)=>{
 const canManage=await allowed(pool,req.user,'notices.manage'),manage=req.query.manage==='true';if(manage&&!canManage)throw fail(403,'Notice management permission is required.');
 const search=typeof req.query.search==='string'?req.query.search.trim().slice(0,100):'';
 const result=await pool.query(`SELECT n.*,n.publish_at::text,n.expires_at::text,u.full_name AS author_name,COALESCE(r.version=n.version,FALSE) AS is_read
 FROM college_notices n JOIN users u ON u.id=n.updated_by LEFT JOIN notice_reads r ON r.notice_id=n.id AND r.user_id=$2
 WHERE n.college_id=$1 AND (${manage?'$3::text IS NOT NULL':visibility}) AND ($4='' OR STRPOS(LOWER(n.title||' '||n.body),LOWER($4))>0)
 ORDER BY n.pinned DESC,n.publish_at DESC,n.id DESC LIMIT 201`,[req.user.college_id,req.user.id,req.user.role,search]);
 res.json({canManage,notices:result.rows.slice(0,200),truncated:result.rows.length>200});
}));
router.post('/',wrap(async(req,res)=>{const values=form(req.body||{});const result=await transaction(async db=>{
 await collegeLock(db,req.user.college_id);await demand(db,req.user,'notices.manage');
 const r=await db.query(`INSERT INTO college_notices(college_id,title,body,audience,department,pinned,status,publish_at,expires_at,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING id`,[req.user.college_id,...values,req.user.id]);await audit(db,req.user,'notice.created','notice',r.rows[0].id,{status:values[5]});return r.rows[0];
});res.status(201).json({...result,message:'Notice saved.'});}));
router.patch('/:id',wrap(async(req,res)=>{const noticeId=id(req.params.id),version=id(req.body?.version),values=form(req.body||{});await transaction(async db=>{
 await collegeLock(db,req.user.college_id);await demand(db,req.user,'notices.manage');
 const r=await db.query(`UPDATE college_notices SET title=$4,body=$5,audience=$6,department=$7,pinned=$8,status=$9,publish_at=$10,expires_at=$11,version=version+1,updated_by=$12,updated_at=NOW()
 WHERE id=$1 AND college_id=$2 AND version=$3 RETURNING id`,[noticeId,req.user.college_id,version,...values,req.user.id]);if(!r.rowCount)throw fail(409,'Notice changed or is unavailable. Refresh before editing.');await audit(db,req.user,'notice.updated','notice',noticeId,{status:values[5],version:version+1});
});res.json({message:'Notice updated. Updated notices appear unread again.'});}));
router.post('/:id/read',wrap(async(req,res)=>{
 const noticeId=id(req.params.id),version=id(req.body?.version);
 const r=await pool.query(`INSERT INTO notice_reads(notice_id,user_id,version)
 SELECT n.id,$2,n.version FROM college_notices n WHERE n.college_id=$1 AND ${visibility} AND n.id=$4 AND n.version=$5
 ON CONFLICT(notice_id,user_id) DO UPDATE SET version=EXCLUDED.version,read_at=NOW() RETURNING notice_id`,[req.user.college_id,req.user.id,req.user.role,noticeId,version]);
 if(!r.rowCount)throw fail(409,'Notice changed or is no longer visible. Refresh the notice board.');res.json({message:'Marked as read.'});
}));router.use(errors);module.exports=router;
