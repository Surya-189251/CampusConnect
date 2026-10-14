const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { rateLimit } = require('express-rate-limit');
const pool = require('./db');
const { requireAuth } = require('./auth');
const { validateStudents } = require('./student-validation');
const router = express.Router();
router.use((req,res,next) => { res.set('Cache-Control','no-store'); next(); });
router.use(requireAuth);
// Read grants from the database, never from browser-supplied role or college fields.
async function allowed(db, user, lock = false, allowAdminRead = false) {
  const account = await db.query(`SELECT role FROM users WHERE id=$1 AND college_id=$2 AND status='approved' AND must_change_password=FALSE ${lock ? 'FOR UPDATE' : ''}`, [user.id,user.college_id]);
  if (account.rows[0]?.role === 'admin') return allowAdminRead;
  if (account.rows[0]?.role !== 'faculty') return false;
  const grant = await db.query("SELECT 1 FROM user_permissions WHERE user_id=$1 AND permission_code='students.manage'", [user.id]);
  return grant.rowCount > 0;
}
router.use(async (req,res,next) => {
  try { if (!await allowed(pool,req.user,false,req.method==='GET')) return res.status(403).json({message:'Only approved faculty with Manage Student Accounts permission can perform this action.'}); next(); }
  catch(error) { next(error); }
});
router.get('/', async (req,res,next) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0,100) : '';
    const result = await pool.query(`SELECT u.id,u.login_id,u.full_name,u.email,u.status,u.must_change_password,
      p.mobile,p.department,p.admission_year,p.semester,p.section
      FROM users u JOIN student_profiles p ON p.user_id=u.id
      WHERE u.college_id=$1 AND u.role='student'
      AND ($2='' OR STRPOS(LOWER(u.login_id || ' ' || u.full_name || ' ' || p.department),LOWER($2))>0)
      ORDER BY u.login_id LIMIT 201`, [req.user.college_id,search]);
    res.json({students:result.rows.slice(0,200),truncated:result.rows.length>200});
  } catch(error) { next(error); }
});
async function check(db, collegeId, input) {
  const result = validateStudents(input);
  if (result.errors.length) return result;
  const existing = await db.query(`SELECT login_id,email FROM users WHERE college_id=$1
    AND (LOWER(login_id)=ANY($2::text[]) OR LOWER(email)=ANY($3::text[]))`,
    [collegeId,result.students.map(s=>s.rollNumber.toLowerCase()),result.students.map(s=>s.email)]);
  result.students.forEach((s,i) => {
    if (existing.rows.some(u=>u.login_id.toLowerCase()===s.rollNumber.toLowerCase())) result.errors.push(`Row ${i+1}: roll number already exists in this college.`);
    if (existing.rows.some(u=>u.email?.toLowerCase()===s.email)) result.errors.push(`Row ${i+1}: email already exists in this college.`);
  });
  return result;
}
router.post('/preview', async (req,res,next) => {
  try { const result=await check(pool,req.user.college_id,req.body?.students); res.status(result.errors.length?400:200).json(result); }
  catch(error) { next(error); }
});
const writeLimiter = rateLimit({windowMs:60*60*1000,limit:30,standardHeaders:true,legacyHeaders:false,
  keyGenerator:req=>String(req.user.id),message:{message:'Too many account changes. Try again in one hour.'}});
router.post('/', writeLimiter, async (req,res,next) => {
  let client;
  try {
    const validated=await check(pool,req.user.college_id,req.body?.students);
    if(validated.errors.length) return res.status(400).json(validated);
    const credentials=[];
    const prepared=[];
    for(const student of validated.students) {
      const password=crypto.randomBytes(15).toString('base64url');
      prepared.push({student,password,hash:await bcrypt.hash(password,12)});
    }
    client=await pool.connect(); await client.query('BEGIN');
    // Same account lock as the admin grant/revoke route prevents permission races.
    if(!await allowed(client,req.user,true)) { await client.query('ROLLBACK'); return res.status(403).json({message:'Permission was removed. No students were created.'}); }
    for(const {student:s,password,hash} of prepared) {
      const user=await client.query(`INSERT INTO users (login_id,full_name,email,password_hash,role,status,college_id,must_change_password)
        VALUES ($1,$2,$3,$4,'student','approved',$5,TRUE) RETURNING id`,[s.rollNumber,s.fullName,s.email,hash,req.user.college_id]);
      const id=user.rows[0].id;
      await client.query(`INSERT INTO student_profiles (user_id,department,admission_year,semester,section,mobile)
        VALUES ($1,$2,$3,$4,$5,$6)`,[id,s.department,+s.admissionYear,+s.semester,s.section,s.mobile]);
      await client.query(`INSERT INTO audit_logs (actor_user_id,action,target_type,target_id,details)
        VALUES ($1,'student.created','user',$2,$3::jsonb)`,[req.user.id,String(id),JSON.stringify({collegeId:req.user.college_id})]);
      credentials.push({rollNumber:s.rollNumber,fullName:s.fullName,temporaryPassword:password});
    }
    await client.query('COMMIT');
    res.status(201).json({message:`Created ${credentials.length} student account(s).`,credentials});
  } catch(error) {
    if(client) await client.query('ROLLBACK').catch(()=>{});
    if(error.code==='23505') return res.status(409).json({message:'A roll number or email already exists. No students from this batch were created. Preview again.'});
    next(error);
  } finally { if(client) client.release(); }
});
// Recovery if a temporary password was lost. Always scoped to this college.
router.post('/:id/reset-password', writeLimiter, async (req,res,next) => {
  let client;
  try {
    const id=Number(req.params.id);
    if(!Number.isInteger(id)||id<1||id>2147483647) return res.status(400).json({message:'Invalid student.'});
    const password=crypto.randomBytes(15).toString('base64url');
    const hash=await bcrypt.hash(password,12);
    client=await pool.connect(); await client.query('BEGIN');
    if(!await allowed(client,req.user,true)) { await client.query('ROLLBACK'); return res.status(403).json({message:'Permission removed.'}); }
    const result=await client.query(`UPDATE users SET password_hash=$1,must_change_password=TRUE,updated_at=NOW()
      WHERE id=$2 AND college_id=$3 AND role='student' AND status='approved' RETURNING login_id,full_name`,[hash,id,req.user.college_id]);
    if(!result.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({message:'Student not found in your college.'}); }
    await client.query('DELETE FROM sessions WHERE user_id=$1',[id]);
    await client.query(`INSERT INTO audit_logs (actor_user_id,action,target_type,target_id) VALUES ($1,'student.password_reset','user',$2)`,[req.user.id,String(id)]);
    await client.query('COMMIT');
    res.json({message:'Temporary password reset. Old sessions were signed out.',credentials:[{rollNumber:result.rows[0].login_id,fullName:result.rows[0].full_name,temporaryPassword:password}]});
  } catch(error) { if(client) await client.query('ROLLBACK').catch(()=>{}); next(error); }
  finally { if(client) client.release(); }
});
module.exports=router;
