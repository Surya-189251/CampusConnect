const express=require('express'),pool=require('./db');const {requireAuth}=require('./auth');
const {fail,id,text,date,wrap,transaction,allowed,demand,collegeLock,audit,errors}=require('./campus-utils');
const router=express.Router();router.use(requireAuth,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
function minute(v){if(typeof v!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))throw fail(400,'Use a valid 24-hour time.');return Number(v.slice(0,2))*60+Number(v.slice(3));}
function form(b){const courseId=id(b.courseId),weekday=id(b.weekday),start=minute(b.startTime),end=minute(b.endTime),room=text(b.room,80,'Room'),from=date(b.validFrom),until=date(b.validUntil);if(weekday>7||end<=start||until<from||(Date.parse(until)-Date.parse(from))>732*86400000)throw fail(400,'Use day 1–7, an end time after the start, and a date range no longer than two years.');
 const first=new Date(from+'T00:00:00Z');const diff=(weekday-(first.getUTCDay()||7)+7)%7;if(Date.parse(from)+diff*86400000>Date.parse(until))throw fail(400,'The selected weekday does not occur in this date range.');return {courseId,weekday,start,end,room,from,until};}
// Check the first actual weekday in the intersecting date ranges, not just date overlap.
const occurrence=`(GREATEST(t.valid_from,$6::date)+((t.weekday-EXTRACT(ISODOW FROM GREATEST(t.valid_from,$6::date))::integer+7)%7))<=LEAST(t.valid_until,$7::date)`;
async function checkClash(db,collegeId,c,f,exclude=0){
 const r=await db.query(`SELECT t.id FROM timetable_slots t JOIN academic_courses a ON a.id=t.course_id
 WHERE a.college_id=$1 AND NOT t.archived AND t.id<>$2 AND t.weekday=$3 AND t.start_minute<$5 AND t.end_minute>$4
 AND ${occurrence} AND (LOWER(t.room)=LOWER($8) OR (a.faculty_id IS NOT NULL AND a.faculty_id=$9)
 OR (LOWER(a.department)=LOWER($10) AND a.admission_year=$11 AND a.semester=$12 AND LOWER(a.section)=LOWER($13))) LIMIT 1`,
 [collegeId,exclude,f.weekday,f.start,f.end,f.from,f.until,f.room,c.faculty_id,c.department,c.admission_year,c.semester,c.section]);
 if(r.rowCount)throw fail(409,'Timetable clash: this room, class or faculty is already booked during the selected time and dates.');
}
async function validateAssignment(db,c,facultyId){if(!facultyId)return;const slots=await db.query('SELECT *,valid_from::text,valid_until::text FROM timetable_slots WHERE course_id=$1 AND NOT archived',[c.id]);
 for(const t of slots.rows)await checkClash(db,c.college_id,{...c,faculty_id:facultyId},{weekday:t.weekday,start:t.start_minute,end:t.end_minute,from:t.valid_from,until:t.valid_until,room:t.room},t.id);
}
router.get('/',wrap(async(req,res)=>{
 const chosen=date(req.query.week||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));const d=new Date(chosen+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));const monday=d.toISOString().slice(0,10);
 const canManage=await allowed(pool,req.user,'timetable.manage'),mine=req.user.role==='faculty'&&req.query.scope!=='all';
 const scope=req.user.role==='student'?'EXISTS(SELECT 1 FROM course_enrollments e WHERE e.course_id=c.id AND e.student_id=$2)':mine?'c.faculty_id=$2':'$2::integer IS NOT NULL';
 const result=await pool.query(`SELECT t.*,t.valid_from::text,t.valid_until::text,($3::date+(t.weekday-1))::text AS occurrence_date,c.code,c.name,c.department,c.admission_year,c.semester,c.section,c.academic_year,f.full_name AS faculty_name
 FROM timetable_slots t JOIN academic_courses c ON c.id=t.course_id LEFT JOIN users f ON f.id=c.faculty_id
 WHERE c.college_id=$1 AND ${scope} AND NOT t.archived AND ($3::date+(t.weekday-1)) BETWEEN t.valid_from AND t.valid_until
 ORDER BY t.weekday,t.start_minute,c.code LIMIT 501`,[req.user.college_id,req.user.id,monday]);
 const courses=canManage?(await pool.query('SELECT id,code,name,department,admission_year,semester,section,academic_year FROM academic_courses WHERE college_id=$1 ORDER BY academic_year DESC,code',[req.user.college_id])).rows:[];
 res.json({slots:result.rows.slice(0,500),truncated:result.rows.length>500,canManage,courses,week:monday});
}));
async function save(req,update){const f=form(req.body||{}),slotId=update?id(req.params.id):0,version=update?id(req.body?.version):0;return transaction(async db=>{
 await collegeLock(db,req.user.college_id);await demand(db,req.user,'timetable.manage');
 const c=(await db.query('SELECT * FROM academic_courses WHERE id=$1 AND college_id=$2 FOR UPDATE',[f.courseId,req.user.college_id])).rows[0];if(!c)throw fail(404,'Choose a course from your college.');
 if(update){const t=(await db.query('SELECT t.* FROM timetable_slots t JOIN academic_courses c ON c.id=t.course_id WHERE t.id=$1 AND c.college_id=$2 FOR UPDATE OF t',[slotId,req.user.college_id])).rows[0];if(!t||t.archived||t.version!==version)throw fail(409,'Slot changed or is unavailable. Refresh before editing.');}
 await checkClash(db,req.user.college_id,c,f,slotId);
 const values=[f.courseId,f.weekday,f.start,f.end,f.room,f.from,f.until,req.user.id];let r;
 if(update)r=await db.query('UPDATE timetable_slots SET course_id=$1,weekday=$2,start_minute=$3,end_minute=$4,room=$5,valid_from=$6,valid_until=$7,updated_by=$8,version=version+1,updated_at=NOW() WHERE id=$9 RETURNING id',[...values,slotId]);
 else r=await db.query('INSERT INTO timetable_slots(course_id,weekday,start_minute,end_minute,room,valid_from,valid_until,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',values);
 await audit(db,req.user,update?'timetable.updated':'timetable.created','timetable',r.rows[0].id,{courseId:f.courseId});return r.rows[0];
});}
router.post('/',wrap(async(req,res)=>res.status(201).json({...await save(req,false),message:'Timetable slot saved.'})));
router.patch('/:id',wrap(async(req,res)=>res.json({...await save(req,true),message:'Timetable slot updated.'})));
router.post('/:id/archive',wrap(async(req,res)=>{const slotId=id(req.params.id),version=id(req.body?.version);await transaction(async db=>{
 await collegeLock(db,req.user.college_id);await demand(db,req.user,'timetable.manage');const r=await db.query(`UPDATE timetable_slots t SET archived=TRUE,version=version+1,updated_by=$4,updated_at=NOW() FROM academic_courses c
 WHERE t.course_id=c.id AND c.college_id=$1 AND t.id=$2 AND t.version=$3 AND NOT t.archived RETURNING t.id`,[req.user.college_id,slotId,version,req.user.id]);if(!r.rowCount)throw fail(409,'Slot changed or is unavailable. Refresh first.');await audit(db,req.user,'timetable.archived','timetable',slotId);
});res.json({message:'Slot archived. Attendance records are unchanged.'});}));
router.use(errors);module.exports={router,validateAssignment};
