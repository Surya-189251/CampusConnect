const express=require('express');
const pool=require('./db');
const {requireAuth,requireRole}=require('./auth');
const router=express.Router();
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.use(requireAuth);
const fail=(status,message)=>Object.assign(new Error(message),{status});
const id=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>2147483647)throw fail(400,'Invalid record ID.');return n;};
const text=(value,max,label)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw fail(400,`${label} is required (maximum ${max} characters).`);return value.trim();};
const integer=(value,min,max,label)=>{const n=Number(value);if(!Number.isInteger(n)||n<min||n>max)throw fail(400,`${label} must be ${min}–${max}.`);return n;};
function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw fail(400,'Choose a valid date.');return value;}
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){next(error);}};
async function transaction(fn){const db=await pool.connect();try{await db.query('BEGIN');const value=await fn(db);await db.query('COMMIT');return value;}catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{db.release();}}
async function course(db,req,write=false,lock=false){
 const r=await db.query(`SELECT * FROM academic_courses WHERE id=$1 AND college_id=$2 ${lock?'FOR UPDATE':''}`,[id(req.params.id),req.user.college_id]);
 if(!r.rows[0])throw fail(404,'Course not found in your college.');
 if(write&&(req.user.role!=='faculty'||r.rows[0].faculty_id!==req.user.id))throw fail(403,'Only the assigned faculty member may edit this class.');
 return r.rows[0];
}
async function checkFaculty(db,collegeId,value){if(value===null||value==='')return null;const facultyId=id(value);const r=await db.query("SELECT id FROM users WHERE id=$1 AND college_id=$2 AND role='faculty' AND status='approved'",[facultyId,collegeId]);if(!r.rowCount)throw fail(400,'Select an approved faculty member from this college.');return facultyId;}
async function enroll(db,c){return db.query(`INSERT INTO course_enrollments(course_id,student_id)
 SELECT $1,u.id FROM users u JOIN student_profiles p ON p.user_id=u.id
 WHERE u.college_id=$2 AND u.role='student' AND u.status='approved'
 AND LOWER(BTRIM(p.department))=LOWER($3) AND p.admission_year=$4 AND p.semester=$5 AND LOWER(BTRIM(p.section))=LOWER($6)
 ON CONFLICT DO NOTHING`,[c.id,c.college_id,c.department,c.admission_year,c.semester,c.section]);}
async function audit(db,req,action,target,details={}){await db.query(`INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,details) VALUES($1,$2,'course',$3,$4::jsonb)`,[req.user.id,action,String(target),JSON.stringify({collegeId:req.user.college_id,...details})]);}
function rowsMatch(records,roster){
 if(!Array.isArray(records)||records.length!==roster.length||records.length<1||records.length>1000)throw fail(400,'Provide exactly one entry for each student in this roster (maximum 1000).');
 const ids=records.map(r=>id(r?.studentId));
 if(new Set(ids).size!==ids.length||ids.some(i=>!roster.includes(i)))throw fail(400,'The submitted students do not match this class roster. Reload it and try again.');
}
// This student endpoint derives identity from the session; request IDs are ignored.
router.get('/mine',requireRole('student'),wrap(async(req,res)=>{
 const params=[req.user.id,req.user.college_id];
 const courses=await pool.query(`SELECT c.id,c.code,c.name,c.academic_year,c.department,c.semester,c.section,
 f.full_name AS faculty_name FROM course_enrollments e JOIN academic_courses c ON c.id=e.course_id
 LEFT JOIN users f ON f.id=c.faculty_id WHERE e.student_id=$1 AND c.college_id=$2 ORDER BY c.academic_year DESC,c.code`,params);
 const attendance=await pool.query(`SELECT r.course_id,
 COUNT(*) FILTER(WHERE r.status='present')::integer AS present,
 COUNT(*) FILTER(WHERE r.status='absent')::integer AS absent,
 COUNT(*) FILTER(WHERE r.status='excused')::integer AS excused
 FROM attendance_records r JOIN academic_courses c ON c.id=r.course_id WHERE r.student_id=$1 AND c.college_id=$2 GROUP BY r.course_id`,params);
 const recent=await pool.query(`SELECT c.code,c.name,s.class_date::text,s.period,r.status FROM attendance_records r
 JOIN attendance_sessions s ON s.id=r.session_id JOIN academic_courses c ON c.id=r.course_id
 WHERE r.student_id=$1 AND c.college_id=$2 ORDER BY s.class_date DESC,s.period DESC,c.code LIMIT 100`,params);
 const marks=await pool.query(`SELECT a.id,c.code,c.name,a.title,a.assessment_date::text,a.max_score,s.score,s.status
 FROM assessment_scores s JOIN assessments a ON a.id=s.assessment_id JOIN academic_courses c ON c.id=s.course_id
 WHERE s.student_id=$1 AND c.college_id=$2 ORDER BY a.assessment_date DESC,a.id DESC`,params);
 res.json({courses:courses.rows,attendance:attendance.rows,recentAttendance:recent.rows,marks:marks.rows});
}));
router.use(requireRole('admin','faculty'));
router.get('/summary',wrap(async(req,res)=>{
 const r=await pool.query(`SELECT
 (SELECT COUNT(*)::integer FROM users WHERE college_id=$1 AND role='student' AND status='approved') AS students,
 (SELECT COUNT(*)::integer FROM users WHERE college_id=$1 AND role='faculty' AND status='approved') AS faculty,
 (SELECT COUNT(*)::integer FROM academic_courses WHERE college_id=$1) AS courses,
 (SELECT COUNT(*)::integer FROM attendance_sessions s JOIN academic_courses c ON c.id=s.course_id WHERE c.college_id=$1) AS sessions,
 (SELECT COUNT(*)::integer FROM assessments a JOIN academic_courses c ON c.id=a.course_id WHERE c.college_id=$1) AS assessments`,[req.user.college_id]);res.json(r.rows[0]);
}));
router.get('/courses',wrap(async(req,res)=>{
 const r=await pool.query(`SELECT c.*,f.full_name AS faculty_name,f.login_id AS faculty_login_id,
 (SELECT COUNT(*)::integer FROM course_enrollments e WHERE e.course_id=c.id) AS student_count
 FROM academic_courses c LEFT JOIN users f ON f.id=c.faculty_id WHERE c.college_id=$1 ORDER BY c.academic_year DESC,c.code,c.section`,[req.user.college_id]);
 res.json({courses:r.rows.map(c=>({...c,canEdit:req.user.role==='faculty'&&c.faculty_id===req.user.id}))});
}));
router.get('/setup-options',requireRole('admin'),wrap(async(req,res)=>{
 const faculty=await pool.query("SELECT id,full_name,login_id FROM users WHERE college_id=$1 AND role='faculty' AND status='approved' ORDER BY full_name",[req.user.college_id]);
 const cohorts=await pool.query(`SELECT DISTINCT p.department,p.admission_year,p.semester,p.section FROM student_profiles p JOIN users u ON u.id=p.user_id WHERE u.college_id=$1 AND u.role='student' AND u.status='approved' ORDER BY p.department,p.admission_year,p.semester,p.section`,[req.user.college_id]);
 res.json({faculty:faculty.rows,cohorts:cohorts.rows});
}));
router.post('/courses',requireRole('admin'),wrap(async(req,res)=>{
 const b=req.body||{};const code=text(b.code,30,'Course code').toUpperCase();if(!/^[A-Z0-9_-]+$/.test(code))throw fail(400,'Course code must contain letters, numbers, hyphens or underscores.');
 const name=text(b.name,150,'Course name'),year=text(b.academicYear,9,'Academic year');
 if(!/^\d{4}-\d{4}$/.test(year)||+year.slice(5)!==+year.slice(0,4)+1||+year.slice(0,4)<2000||+year.slice(0,4)>2100)throw fail(400,'Use an academic year such as 2026-2027.');
 const department=text(b.department,100,'Department'),section=text(b.section,20,'Section');
 const admissionYear=integer(b.admissionYear,2000,2100,'Admission year'),semester=integer(b.semester,1,8,'Semester');
 const result=await transaction(async db=>{
  const facultyId=await checkFaculty(db,req.user.college_id,b.facultyId??null);
  const r=await db.query(`INSERT INTO academic_courses(college_id,code,name,academic_year,department,admission_year,semester,section,faculty_id,created_by)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[req.user.college_id,code,name,year,department,admissionYear,semester,section,facultyId,req.user.id]);
  const c=r.rows[0];const enrolled=await enroll(db,c);await audit(db,req,'course.created',c.id,{facultyId,enrolled:enrolled.rowCount});return {course:c,enrolled:enrolled.rowCount};
 });res.status(201).json({...result,message:'Course created and matching students enrolled.'});
}));
router.patch('/courses/:id/faculty',requireRole('admin'),wrap(async(req,res)=>{
 await transaction(async db=>{await require('./campus-utils').collegeLock(db,req.user.college_id);const c=await course(db,req,false,true);const facultyId=await checkFaculty(db,req.user.college_id,req.body?.facultyId);
 await require('./timetable').validateAssignment(db,c,facultyId);
 await db.query('UPDATE academic_courses SET faculty_id=$1 WHERE id=$2',[facultyId,c.id]);await audit(db,req,'course.faculty_assigned',c.id,{previousFacultyId:c.faculty_id,facultyId});});
 res.json({message:'Faculty assignment updated. Previous faculty can no longer edit this class.'});
}));
router.post('/courses/:id/sync-roster',requireRole('admin'),wrap(async(req,res)=>{
 const count=await transaction(async db=>{const c=await course(db,req,false,true);const r=await enroll(db,c);await audit(db,req,'course.roster_synced',c.id,{added:r.rowCount});return r.rowCount;});
 res.json({message:`Added ${count} matching student(s). Existing session and assessment rosters were preserved.`});
}));
router.get('/courses/:id/roster',wrap(async(req,res)=>{
 const c=await course(pool,req);const r=await pool.query(`SELECT u.id,u.login_id,u.full_name,
 COALESCE(t.present,0)::integer AS present,COALESCE(t.absent,0)::integer AS absent,COALESCE(t.excused,0)::integer AS excused
 FROM course_enrollments e JOIN users u ON u.id=e.student_id
 LEFT JOIN (SELECT student_id,COUNT(*) FILTER(WHERE status='present') AS present,COUNT(*) FILTER(WHERE status='absent') AS absent,COUNT(*) FILTER(WHERE status='excused') AS excused FROM attendance_records WHERE course_id=$1 GROUP BY student_id) t ON t.student_id=u.id
 WHERE e.course_id=$1 ORDER BY u.login_id`,[c.id]);res.json({students:r.rows});
}));
router.get('/courses/:id/attendance',wrap(async(req,res)=>{
 const c=await course(pool,req);const day=date(req.query.date),period=integer(req.query.period,1,12,'Period');
 const session=await pool.query('SELECT id,version FROM attendance_sessions WHERE course_id=$1 AND class_date=$2 AND period=$3',[c.id,day,period]);
 const s=session.rows[0];
 const r=s?await pool.query(`SELECT u.id,u.login_id,u.full_name,r.status FROM attendance_records r JOIN users u ON u.id=r.student_id WHERE r.session_id=$1 ORDER BY u.login_id`,[s.id]):await pool.query(`SELECT u.id,u.login_id,u.full_name,NULL::text AS status FROM course_enrollments e JOIN users u ON u.id=e.student_id WHERE e.course_id=$1 AND u.status='approved' ORDER BY u.login_id`,[c.id]);
 res.json({version:s?.version||0,students:r.rows,saved:Boolean(s)});
}));
router.put('/courses/:id/attendance',wrap(async(req,res)=>{
 const b=req.body||{},day=date(b.date),period=integer(b.period,1,12,'Period'),version=integer(b.version,0,2147483646,'Version');if(day>today())throw fail(400,'Attendance cannot be saved for a future date.');
 const result=await transaction(async db=>{
  const c=await course(db,req,true,true);
  const existing=await db.query('SELECT id,version FROM attendance_sessions WHERE course_id=$1 AND class_date=$2 AND period=$3 FOR UPDATE',[c.id,day,period]);const s=existing.rows[0];
  if((s?.version||0)!==version)throw fail(409,'This attendance was changed elsewhere. Reload the register before saving.');
  const roster=s?await db.query('SELECT student_id AS id FROM attendance_records WHERE session_id=$1',[s.id]):await db.query("SELECT u.id FROM course_enrollments e JOIN users u ON u.id=e.student_id WHERE e.course_id=$1 AND u.status='approved'",[c.id]);
  rowsMatch(b.records,roster.rows.map(r=>r.id));
  if(b.records.some(r=>!['present','absent','excused'].includes(r.status)))throw fail(400,'Mark every student Present, Absent or Excused.');
  const saved=s?await db.query('UPDATE attendance_sessions SET version=version+1,recorded_by=$1,updated_at=NOW() WHERE id=$2 RETURNING id,version',[req.user.id,s.id]):await db.query('INSERT INTO attendance_sessions(course_id,class_date,period,recorded_by) VALUES($1,$2,$3,$4) RETURNING id,version',[c.id,day,period,req.user.id]);
  for(const record of b.records)await db.query(`INSERT INTO attendance_records(session_id,course_id,student_id,status) VALUES($1,$2,$3,$4) ON CONFLICT(session_id,student_id) DO UPDATE SET status=EXCLUDED.status`,[saved.rows[0].id,c.id,id(record.studentId),record.status]);
  await audit(db,req,'attendance.saved',c.id,{date:day,period,version:saved.rows[0].version,count:b.records.length});return saved.rows[0];
 });res.json({...result,message:'Attendance saved.'});
}));
router.get('/courses/:id/assessments',wrap(async(req,res)=>{const c=await course(pool,req);const r=await pool.query('SELECT id,title,assessment_date::text,max_score,version FROM assessments WHERE course_id=$1 ORDER BY assessment_date DESC,id DESC',[c.id]);res.json({assessments:r.rows});}));
router.post('/courses/:id/assessments',wrap(async(req,res)=>{
 const b=req.body||{},title=text(b.title,100,'Assessment title'),day=date(b.date);
 const max=Number(b.maxScore);if(!/^\d+(\.\d{1,2})?$/.test(String(b.maxScore))||!Number.isFinite(max)||max<=0||max>1000)throw fail(400,'Maximum marks must be greater than 0 and at most 1000, with at most two decimals.');
 const result=await transaction(async db=>{const c=await course(db,req,true,true);
 const roster=await db.query("SELECT u.id FROM course_enrollments e JOIN users u ON u.id=e.student_id WHERE e.course_id=$1 AND u.status='approved'",[c.id]);if(!roster.rowCount||roster.rowCount>1000)throw fail(400,'The class must have 1–1000 approved students before creating an assessment.');
 const r=await db.query('INSERT INTO assessments(course_id,title,assessment_date,max_score,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',[c.id,title,day,max,req.user.id]);
 for(const student of roster.rows)await db.query('INSERT INTO assessment_scores(assessment_id,course_id,student_id) VALUES($1,$2,$3)',[r.rows[0].id,c.id,student.id]);
 await audit(db,req,'assessment.created',c.id,{assessmentId:r.rows[0].id,title,maxScore:max});return r.rows[0];
 });res.status(201).json({...result,message:'Assessment created. Enter marks below.'});
}));
router.get('/courses/:id/assessments/:assessmentId',wrap(async(req,res)=>{
 const c=await course(pool,req);const a=await pool.query('SELECT id,title,max_score,version,assessment_date::text FROM assessments WHERE id=$1 AND course_id=$2',[id(req.params.assessmentId),c.id]);if(!a.rowCount)throw fail(404,'Assessment not found in this course.');
 const r=await pool.query(`SELECT u.id,u.login_id,u.full_name,s.score,s.status FROM assessment_scores s JOIN users u ON u.id=s.student_id WHERE s.assessment_id=$1 ORDER BY u.login_id`,[a.rows[0].id]);res.json({assessment:a.rows[0],students:r.rows});
}));
router.put('/courses/:id/assessments/:assessmentId',wrap(async(req,res)=>{
 const b=req.body||{},version=integer(b.version,1,2147483646,'Version');
 const result=await transaction(async db=>{const c=await course(db,req,true,true);
 const ar=await db.query('SELECT * FROM assessments WHERE id=$1 AND course_id=$2 FOR UPDATE',[id(req.params.assessmentId),c.id]);const a=ar.rows[0];if(!a)throw fail(404,'Assessment not found in this course.');if(a.version!==version)throw fail(409,'Marks were changed elsewhere. Reload this assessment before saving.');
 const roster=await db.query('SELECT student_id AS id FROM assessment_scores WHERE assessment_id=$1',[a.id]);rowsMatch(b.records,roster.rows.map(r=>r.id));
 for(const r of b.records){if(!['graded','absent','ungraded'].includes(r.status))throw fail(400,'Invalid marks status.');
  if(r.status==='graded'&&(!/^\d+(\.\d{1,2})?$/.test(String(r.score))||!Number.isFinite(Number(r.score))||Number(r.score)<0||Number(r.score)>Number(a.max_score)))throw fail(400,`Marks must be 0–${a.max_score}, with at most two decimals.`);
  if(r.status!=='graded'&&r.score!==null)throw fail(400,'Absent or ungraded entries must have no score.');
 }
 for(const r of b.records)await db.query('UPDATE assessment_scores SET score=$1,status=$2 WHERE assessment_id=$3 AND student_id=$4',[r.status==='graded'?Number(r.score):null,r.status,a.id,id(r.studentId)]);
 const updated=await db.query('UPDATE assessments SET version=version+1,updated_at=NOW() WHERE id=$1 RETURNING version',[a.id]);await audit(db,req,'marks.saved',c.id,{assessmentId:a.id,count:b.records.length,version:updated.rows[0].version});return updated.rows[0];
 });res.json({...result,message:'Marks saved. Students can see their own results.'});
}));
router.use((error,req,res,next)=>{
 if(error.status)return res.status(error.status).json({message:error.message});
 if(error.code==='23505')return res.status(409).json({message:'This course/class or assessment title already exists. Use the existing record.'});
 next(error);
});
module.exports=router;
