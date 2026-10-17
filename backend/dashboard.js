const express=require('express'),pool=require('./db');const {requireAuth}=require('./auth');const {wrap,errors}=require('./campus-utils');
const router=express.Router();router.use(requireAuth,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/',wrap(async(req,res)=>{
 const u=req.user,p=[u.college_id,u.id];let metrics;
 if(u.role==='admin')metrics=(await pool.query(`SELECT
 (SELECT COUNT(*)::integer FROM users WHERE college_id=$1 AND role='student' AND status='approved') AS students,
 (SELECT COUNT(*)::integer FROM users WHERE college_id=$1 AND role='faculty' AND status='approved') AS faculty,
 (SELECT COUNT(*)::integer FROM academic_courses WHERE college_id=$1) AS courses,
 (SELECT COUNT(*)::integer FROM users WHERE college_id=$1 AND role='faculty' AND status='pending') AS pending`,[u.college_id])).rows[0];
 else if(u.role==='faculty')metrics=(await pool.query(`SELECT
 (SELECT COUNT(*)::integer FROM academic_courses WHERE college_id=$1 AND faculty_id=$2) AS courses,
 (SELECT COUNT(DISTINCT e.student_id)::integer FROM course_enrollments e JOIN academic_courses c ON c.id=e.course_id WHERE c.college_id=$1 AND c.faculty_id=$2) AS students,
 (SELECT COUNT(*)::integer FROM attendance_sessions a JOIN academic_courses c ON c.id=a.course_id WHERE c.college_id=$1 AND c.faculty_id=$2) AS registers,
 (SELECT COUNT(*)::integer FROM assessments a JOIN academic_courses c ON c.id=a.course_id WHERE c.college_id=$1 AND c.faculty_id=$2) AS assessments`,p)).rows[0];
 else metrics=(await pool.query(`SELECT
 (SELECT COUNT(*)::integer FROM course_enrollments e JOIN academic_courses c ON c.id=e.course_id WHERE c.college_id=$1 AND e.student_id=$2) AS courses,
 (SELECT COUNT(*)::integer FROM attendance_records a JOIN academic_courses c ON c.id=a.course_id WHERE c.college_id=$1 AND a.student_id=$2 AND a.status='present') AS present,
 (SELECT COUNT(*)::integer FROM attendance_records a JOIN academic_courses c ON c.id=a.course_id WHERE c.college_id=$1 AND a.student_id=$2 AND a.status='absent') AS absent,
 (SELECT COUNT(*)::integer FROM assessment_scores a JOIN academic_courses c ON c.id=a.course_id WHERE c.college_id=$1 AND a.student_id=$2 AND a.status='graded') AS graded`,p)).rows[0];
 const visible=`n.college_id=$1 AND n.status='published' AND n.publish_at<=NOW() AND (n.expires_at IS NULL OR n.expires_at>NOW()) AND ($3='admin' OR ((n.audience='all' OR n.audience=CASE WHEN $3='student' THEN 'students' ELSE 'faculty' END) AND (n.department='' OR LOWER(n.department)=LOWER(COALESCE((SELECT department FROM student_profiles WHERE user_id=$2),(SELECT department FROM faculty_profiles WHERE user_id=$2),'')))))`;
 const notices=(await pool.query(`SELECT n.id,n.title,n.publish_at,n.pinned,n.audience FROM college_notices n WHERE ${visible} ORDER BY n.pinned DESC,n.publish_at DESC,n.id DESC LIMIT 3`,[...p,u.role])).rows;
 const unread=(await pool.query(`SELECT COUNT(*)::integer AS count FROM college_notices n WHERE ${visible} AND NOT EXISTS(SELECT 1 FROM notice_reads r WHERE r.notice_id=n.id AND r.user_id=$2 AND r.version=n.version)`,[...p,u.role])).rows[0].count;
 const scope=u.role==='student'?'EXISTS(SELECT 1 FROM course_enrollments e WHERE e.course_id=c.id AND e.student_id=$2)':u.role==='faculty'?'c.faculty_id=$2':'$2::integer IS NOT NULL';
 const today=(await pool.query(`SELECT t.id,t.start_minute,t.end_minute,t.room,c.code,c.name,c.section,f.full_name AS faculty_name FROM timetable_slots t JOIN academic_courses c ON c.id=t.course_id LEFT JOIN users f ON f.id=c.faculty_id WHERE c.college_id=$1 AND ${scope} AND NOT t.archived AND t.weekday=EXTRACT(ISODOW FROM NOW() AT TIME ZONE 'Asia/Kolkata') AND (NOW() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN t.valid_from AND t.valid_until ORDER BY t.start_minute,c.code LIMIT 6`,p)).rows;
 const ticketScope=`college_id=$1 AND ($3='admin' OR reporter_id=$2)`;
 const openTickets=(await pool.query(`SELECT COUNT(*)::integer AS count FROM support_tickets WHERE ${ticketScope} AND status IN ('open','in_progress')`,[...p,u.role])).rows[0].count;
 res.json({metrics,notices,unreadNotices:unread,openTickets,today:today.slice(0,5),moreClasses:today.length>5});
}));router.use(errors);module.exports=router;
