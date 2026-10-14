import {useEffect,useState} from 'react';
import {academicRequest,collegeToday} from './academic-api';
import './Academics.css';
const courseLabel=c=>`${c.code} — ${c.name} · ${c.academic_year} · ${c.department} / ${c.admission_year} / Sem ${c.semester} / ${c.section}`;
function Notice({error,message}){return <>{error&&<p role="alert" className="auth-error">{error}</p>}{message&&<p role="status" className="auth-success">{message}</p>}</>;}
export default function AcademicPortal({token,isAdmin=false,mode='Courses'}) {
 const [courses,setCourses]=useState([]),[selected,setSelected]=useState(''),[refresh,setRefresh]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();
  academicRequest(token,'/courses',{signal:controller.signal}).then(data=>{setCourses(data.courses);setError('');}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[token,refresh]);
 function reload(){setLoading(true);setRefresh(n=>n+1);}
 const course=courses.find(c=>String(c.id)===selected);
 return <div className="academic-stack">
  <section className="panel"><div className="section-heading"><div><h2>{mode}</h2><p>All records below are from your college database.</p></div><button className="button" onClick={reload} disabled={loading}>Refresh courses</button></div>
   <Notice error={error}/>{loading?<p>Loading…</p>:<>
    {!courses.length&&<p>No courses yet. The administrator can create one from Courses after faculty have added student accounts.</p>}
    <label className="auth-field"><span>Select course and class</span><select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choose a course</option>{courses.map(c=><option key={c.id} value={c.id}>{courseLabel(c)}{c.canEdit?' · Assigned to you':''}</option>)}</select></label>
    {course&&<p><strong>{course.student_count} enrolled students.</strong> Faculty: {course.faculty_name||'Unassigned'}. {course.canEdit?'You can record attendance and marks.':'You have read-only access to this class.'}</p>}
   </>}
  </section>
  {mode==='Courses'&&isAdmin&&<CourseSetup token={token} onSaved={reload}/>}
  {!loading&&course&&mode==='Courses'&&<CourseDetails key={course.id} token={token} course={course} isAdmin={isAdmin} onSaved={reload}/>}
  {!loading&&course&&mode==='Attendance'&&<Attendance key={course.id} token={token} course={course}/>}
  {!loading&&course&&mode==='Marks'&&<Marks key={course.id} token={token} course={course}/>}
 </div>;
}
function CourseSetup({token,onSaved}) {
 const [options,setOptions]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [form,setForm]=useState({code:'',name:'',academicYear:'2026-2027',cohort:'',facultyId:''});
 useEffect(()=>{const controller=new AbortController();academicRequest(token,'/setup-options',{signal:controller.signal}).then(setOptions).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>controller.abort();},[token]);
 async function submit(e){e.preventDefault();setError('');setMessage('');setBusy(true);try{
  const c=options?.cohorts[Number(form.cohort)];if(!c||form.cohort==='')throw new Error('Choose a student class.');
  const data=await academicRequest(token,'/courses',{method:'POST',body:{...form,department:c.department,admissionYear:c.admission_year,semester:c.semester,section:c.section}});
  setMessage(`${data.message} ${data.enrolled} students enrolled.`);setForm({...form,code:'',name:''});onSaved();
 }catch(err){setError(err.message);}finally{setBusy(false);}}
 return <section className="panel"><h2>Create a course and assign its class</h2><p>This enrolls existing students whose department, admission year, semester and section match the selected class.</p><Notice error={error} message={message}/>
  <form onSubmit={submit}><fieldset className="student-fields" disabled={busy||!options}>
   {[['code','Course code'],['name','Course name'],['academicYear','Academic year (2026-2027)']].map(([key,label])=><label className="auth-field" key={key}><span>{label}</span><input required maxLength={key==='code'?30:key==='name'?150:9} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}
   <label className="auth-field"><span>Student class</span><select required value={form.cohort} onChange={e=>setForm({...form,cohort:e.target.value})}><option value="">Choose existing class</option>{options?.cohorts.map((c,i)=><option value={i} key={i}>{c.department} / {c.admission_year} / Sem {c.semester} / {c.section}</option>)}</select></label>
   <label className="auth-field"><span>Assigned faculty</span><select value={form.facultyId} onChange={e=>setForm({...form,facultyId:e.target.value})}><option value="">Assign later</option>{options?.faculty.map(f=><option value={f.id} key={f.id}>{f.full_name} ({f.login_id})</option>)}</select></label>
  </fieldset><button className="button primary" disabled={busy||!options}>{busy?'Creating…':'Create course'}</button></form>
 </section>;
}
function CourseDetails({token,course,isAdmin,onSaved}) {
 const [students,setStudents]=useState(null),[faculty,setFaculty]=useState([]),[facultyId,setFacultyId]=useState(String(course.faculty_id||'')),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{const controller=new AbortController();academicRequest(token,`/courses/${course.id}/roster`,{signal:controller.signal}).then(data=>setStudents(data.students)).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
  if(isAdmin)academicRequest(token,'/setup-options',{signal:controller.signal}).then(data=>setFaculty(data.faculty)).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>controller.abort();
 },[token,course.id,isAdmin]);
 async function update(path,method,body){setBusy(true);setError('');try{const data=await academicRequest(token,`/courses/${course.id}/${path}`,{method,body});setMessage(data.message);onSaved();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section className="panel"><h2>Class roster</h2><p>Attendance totals include saved periods. Excused periods are excluded from the percentage.</p><Notice error={error} message={message}/>
  {isAdmin&&<><div className="student-actions"><label className="auth-field"><span>Change assigned faculty</span><select value={facultyId} onChange={e=>setFacultyId(e.target.value)} disabled={busy}><option value="">Unassigned</option>{faculty.map(f=><option key={f.id} value={f.id}>{f.full_name} ({f.login_id})</option>)}</select></label>
   <button className="button" disabled={busy} onClick={()=>update('faculty','PATCH',{facultyId})}>Save assignment</button>
   <button className="button" disabled={busy} onClick={()=>update('sync-roster','POST',{})}>Add newly matching students</button></div>
   <p>Sync adds newly imported students to future registers and assessments. It preserves existing attendance and assessment rosters.</p></>}
  {!students?<p>Loading roster…</p>:<div className="table-scroll"><table><thead><tr><th>Roll number</th><th>Name</th><th>Present</th><th>Absent</th><th>Excused</th><th>Attendance</th></tr></thead><tbody>{students.map(s=><tr key={s.id}><td>{s.login_id}</td><td>{s.full_name}</td><td>{s.present}</td><td>{s.absent}</td><td>{s.excused}</td><td>{s.present+s.absent?`${(100*s.present/(s.present+s.absent)).toFixed(1)}%`:"No counted periods"}</td></tr>)}</tbody></table>{!students.length&&<p>No students enrolled yet.</p>}</div>}
 </section>;
}
function Attendance({token,course}) {
 const [date,setDate]=useState(collegeToday()),[period,setPeriod]=useState('1');
 return <section className="panel"><h2>Attendance register</h2><p>Select the date and period. Present and Absent count toward the percentage; Excused is excluded. Changing the selection discards unsaved edits.</p>
  <div className="student-fields"><label className="auth-field"><span>Class date</span><input type="date" max={collegeToday()} value={date} onChange={e=>setDate(e.target.value)}/></label><label className="auth-field"><span>Period</span><select value={period} onChange={e=>setPeriod(e.target.value)}>{Array.from({length:12},(_,i)=><option key={i} value={i+1}>{i+1}</option>)}</select></label></div>
  {date&&<AttendanceRegister key={`${date}/${period}`} token={token} course={course} date={date} period={period}/>}
 </section>;
}
function AttendanceRegister({token,course,date,period}) {
 const [data,setData]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
 useEffect(()=>{const controller=new AbortController();academicRequest(token,`/courses/${course.id}/attendance?date=${date}&period=${period}`,{signal:controller.signal}).then(setData).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>controller.abort();},[token,course.id,date,period,reload]);
 function status(id,value){setData({...data,students:data.students.map(s=>s.id===id?{...s,status:value}:s)});setMessage('');}
 async function save(){setError('');setMessage('');setBusy(true);try{const saved=await academicRequest(token,`/courses/${course.id}/attendance`,{method:'PUT',body:{date,period,version:data.version,records:data.students.map(s=>({studentId:s.id,status:s.status}))}});setData({...data,version:saved.version,saved:true});setMessage(saved.message);}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <><Notice error={error} message={message}/><button className="button" disabled={busy} onClick={()=>{setData(null);setError('');setMessage('');setReload(n=>n+1);}}>Reload register</button>
  {!data?<p>Loading register…</p>:<><p>{data.saved?'Saved register — changes will update existing entries.':'New register — nothing has been saved.'}</p>
   {course.canEdit&&data.students.length>0&&<button className="button" disabled={busy} onClick={()=>{if(window.confirm('Mark every student Present? Review exceptions before saving.'))setData({...data,students:data.students.map(s=>({...s,status:'present'}))});}}>Mark all Present</button>}
   <div className="table-scroll"><table><thead><tr><th>Roll number</th><th>Name</th><th>Status</th></tr></thead><tbody>{data.students.map(s=><tr key={s.id}><td>{s.login_id}</td><td>{s.full_name}</td><td><select aria-label={`Attendance for ${s.login_id}`} disabled={!course.canEdit||busy} value={s.status||''} onChange={e=>status(s.id,e.target.value)}><option value="">Not marked</option><option value="present">Present</option><option value="absent">Absent</option><option value="excused">Excused</option></select></td></tr>)}</tbody></table></div>
   {!data.students.length&&<p>No students in this roster. Ask the administrator to sync the class after student accounts are added.</p>}
   {course.canEdit&&<button className="button primary" disabled={busy||!data.students.length||data.students.some(s=>!s.status)} onClick={save}>{busy?'Saving…':'Save attendance'}</button>}
  </>}
 </>;
}
function Marks({token,course}) {
 const [assessments,setAssessments]=useState([]),[selected,setSelected]=useState(''),[refresh,setRefresh]=useState(0),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [form,setForm]=useState({title:'',date:collegeToday(),maxScore:'100'});
 useEffect(()=>{const controller=new AbortController();academicRequest(token,`/courses/${course.id}/assessments`,{signal:controller.signal}).then(d=>setAssessments(d.assessments)).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>controller.abort();},[token,course.id,refresh]);
 async function create(e){e.preventDefault();setBusy(true);setError('');try{const d=await academicRequest(token,`/courses/${course.id}/assessments`,{method:'POST',body:form});setMessage(d.message);setSelected(String(d.id));setRefresh(n=>n+1);setForm({...form,title:''});}catch(err){setError(err.message);}finally{setBusy(false);}}
 return <section className="panel"><h2>Assessments and marks</h2><Notice error={error} message={message}/>
  {course.canEdit&&<form onSubmit={create}><fieldset className="student-fields" disabled={busy}><label className="auth-field"><span>Assessment title</span><input required maxLength={100} placeholder="Midterm 1" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label><label className="auth-field"><span>Assessment date</span><input type="date" required value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label><label className="auth-field"><span>Maximum marks</span><input type="number" required min="0.01" max="1000" step="0.01" value={form.maxScore} onChange={e=>setForm({...form,maxScore:e.target.value})}/></label></fieldset><button className="button" disabled={busy}>{busy?'Creating…':'Create assessment'}</button></form>}
  <label className="auth-field"><span>Select assessment</span><select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choose assessment</option>{assessments.map(a=><option value={a.id} key={a.id}>{a.title} · {a.assessment_date} · Max {a.max_score}</option>)}</select></label>
  {!assessments.length&&<p>No assessments recorded yet.</p>}
  {selected&&<MarkRegister key={selected} token={token} course={course} assessmentId={selected}/>}
 </section>;
}
function MarkRegister({token,course,assessmentId}) {
 const [data,setData]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
 useEffect(()=>{const controller=new AbortController();academicRequest(token,`/courses/${course.id}/assessments/${assessmentId}`,{signal:controller.signal}).then(setData).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>controller.abort();},[token,course.id,assessmentId,refresh]);
 function edit(id,patch){setData({...data,students:data.students.map(s=>s.id===id?{...s,...patch}:s)});setMessage('');}
 async function save(){setBusy(true);setError('');setMessage('');try{const d=await academicRequest(token,`/courses/${course.id}/assessments/${assessmentId}`,{method:'PUT',body:{version:data.assessment.version,records:data.students.map(s=>({studentId:s.id,status:s.status,score:s.status==='graded'?s.score:null}))}});setData({...data,assessment:{...data.assessment,version:d.version}});setMessage(d.message);}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <><Notice error={error} message={message}/><button className="button" disabled={busy} onClick={()=>{setData(null);setError('');setMessage('');setRefresh(n=>n+1);}}>Reload marks</button>
  {!data?<p>Loading marks…</p>:<><h3>{data.assessment.title} — maximum {data.assessment.max_score}</h3><p>Ungraded means no result yet. A score of 0 is a recorded mark. Saved results are visible to the individual student.</p>
   <div className="table-scroll"><table><thead><tr><th>Roll number</th><th>Name</th><th>Status</th><th>Marks</th></tr></thead><tbody>{data.students.map(s=><tr key={s.id}><td>{s.login_id}</td><td>{s.full_name}</td><td><select aria-label={`Marks status for ${s.login_id}`} disabled={!course.canEdit||busy} value={s.status} onChange={e=>edit(s.id,{status:e.target.value,score:null})}><option value="ungraded">Ungraded</option><option value="graded">Graded</option><option value="absent">Absent</option></select></td><td><input aria-label={`Marks for ${s.login_id}`} type="number" min="0" max={data.assessment.max_score} step="0.01" disabled={!course.canEdit||busy||s.status!=='graded'} value={s.score??''} onChange={e=>edit(s.id,{score:e.target.value})}/></td></tr>)}</tbody></table></div>
   {course.canEdit&&<button className="button primary" disabled={busy} onClick={save}>{busy?'Saving…':'Save marks'}</button>}
  </>}
 </>;
}
