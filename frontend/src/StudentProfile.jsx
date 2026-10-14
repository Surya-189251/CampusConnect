import NoticeBoard from './NoticeBoard';
import Timetable from './Timetable';
import FeesPortal from "./FeesPortal";
import MyAcademics from "./MyAcademics";
import { useEffect, useState } from 'react';
export default function StudentProfile({token}) {
  const [page,setPage]=useState('Profile');
  const [profile,setProfile]=useState(null),[error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    fetch('http://localhost:5000/api/auth/student-profile',{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
      .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.message);return data;})
      .then(data=>setProfile(data.profile)).catch(err=>{if(err.name!=='AbortError')setError(err.message);});
    return ()=>controller.abort();
  },[token]);
  return <main className="staff-workspace"><nav className="academic-tabs student-module-nav" aria-label="Student modules">{['Profile','Notices','Timetable','Academics','Fees'].map(t=><button className={`button ${page===t?'primary':''}`} key={t} onClick={()=>setPage(t)}>{t}</button>)}</nav>{page==='Profile'&&<section className="panel"><h1>My student profile</h1>
    {error && <p role="alert" className="auth-error">{error}</p>}
    {!profile&&!error&&<p>Loading your profile…</p>}
    {profile&&<dl className="student-fields">{[['login_id','Roll number'],['full_name','Name'],['email','Email'],['mobile','Mobile'],['department','Department'],['admission_year','Admission year'],['semester','Semester'],['section','Section']].map(([key,label])=><div key={key}><dt>{label}</dt><dd>{profile[key]||'Not recorded'}</dd></div>)}</dl>}
    <p>For corrections to your details, contact faculty authorised to manage student accounts.</p>
  </section>}{page==='Academics'&&<MyAcademics token={token}/>} {page==='Fees'&&<FeesPortal token={token} role="student"/>}{page==='Notices'&&<NoticeBoard token={token}/>} {page==='Timetable'&&<Timetable token={token} role="student"/>}</main>;
}
