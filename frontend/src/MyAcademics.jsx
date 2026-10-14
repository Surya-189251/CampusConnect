import {useEffect,useState} from 'react';
import {academicRequest} from './academic-api';
import './Academics.css';
export default function MyAcademics({token}) {
 const [data,setData]=useState(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 useEffect(()=>{const controller=new AbortController();academicRequest(token,'/mine',{signal:controller.signal}).then(setData).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>controller.abort();},[token,refresh]);
 return <div className="academic-stack"><section className="panel"><div className="section-heading"><h2>My attendance</h2><button className="button" onClick={()=>{setError('');setData(null);setRefresh(n=>n+1);}}>Refresh my records</button></div>
  {error&&<p role="alert" className="auth-error">{error}</p>}
  {!data&&!error&&<p>Loading your records…</p>}
  {data&&<><p>Percentage = Present ÷ (Present + Absent). Excused periods are excluded. Only saved registers are counted.</p>
   <div className="table-scroll"><table><thead><tr><th>Course / year</th><th>Faculty</th><th>Present</th><th>Absent</th><th>Excused</th><th>Attendance</th></tr></thead><tbody>{data.courses.map(c=>{const a=data.attendance.find(x=>x.course_id===c.id)||{present:0,absent:0,excused:0};const total=a.present+a.absent;return <tr key={c.id}><td>{c.code} — {c.name}<br/>{c.academic_year} · Sem {c.semester} / {c.section}</td><td>{c.faculty_name||'Not assigned'}</td><td>{a.present}</td><td>{a.absent}</td><td>{a.excused}</td><td>{total?`${(100*a.present/total).toFixed(1)}%`:'No counted periods'}</td></tr>;})}</tbody></table></div>
   {!data.courses.length&&<p>No courses assigned yet. Your college administrator needs to create or sync your class roster.</p>}
  </>}
 </section>
 {data&&<><section className="panel"><h2>My marks</h2><div className="table-scroll"><table><thead><tr><th>Course</th><th>Assessment</th><th>Date</th><th>Result</th></tr></thead><tbody>{data.marks.map(m=><tr key={m.id}><td>{m.code} — {m.name}</td><td>{m.title}</td><td>{m.assessment_date}</td><td>{m.status==='graded'?`${m.score} / ${m.max_score}`:m.status==='absent'?'Absent':'Not graded yet'}</td></tr>)}</tbody></table></div>{!data.marks.length&&<p>No assessments recorded yet.</p>}</section>
 <section className="panel"><h2>My recent attendance</h2><p>Latest 100 recorded periods. The totals above include all your saved periods.</p><div className="table-scroll"><table><thead><tr><th>Date</th><th>Course</th><th>Period</th><th>Status</th></tr></thead><tbody>{data.recentAttendance.map((r,i)=><tr key={i}><td>{r.class_date}</td><td>{r.code} — {r.name}</td><td>{r.period}</td><td>{r.status}</td></tr>)}</tbody></table></div>{!data.recentAttendance.length&&<p>No attendance recorded yet.</p>}</section></>}
 </div>;
}
