import NoticeBoard from './NoticeBoard';
import Timetable from './Timetable';
import CollegeManagement from './CollegeManagement';
import FeesPortal from "./FeesPortal";
import {useEffect,useState} from 'react';
import StudentManager from './StudentManager';
import FacultyPermissions from './FacultyPermissions';
import AdminFaculty from './AdminFaculty';
import AcademicPortal from './AcademicPortal';
import {academicRequest} from './academic-api';
import './App.css';
const navigation=['Dashboard','Students','Courses','Attendance','Marks','Fees','Notices','Timetable','College Management','Faculty Requests','Faculty Permissions'];
function Overview({token,navigate}) {
 const [data,setData]=useState(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 useEffect(()=>{const controller=new AbortController();academicRequest(token,'/summary',{signal:controller.signal}).then(setData).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>controller.abort();},[token,refresh]);
 return <><section className="panel"><div className="section-heading"><h2>Your college overview</h2><button className="button" onClick={()=>{setError('');setData(null);setRefresh(n=>n+1);}}>Refresh totals</button></div>{error&&<p role="alert" className="auth-error">{error}</p>}{!data&&!error&&<p>Loading totals…</p>}</section>
 {data&&<div className="stats-grid">{[['Approved students',data.students],['Approved faculty',data.faculty],['Course classes',data.courses],['Saved attendance registers',data.sessions],['Assessments',data.assessments]].map(([label,value])=><section className="stat-card" key={label}><h2>{label}</h2><strong className="stat-value">{value}</strong><p>From your college database</p></section>)}</div>}
 <section className="panel"><h2>Academic setup</h2><p>Give approved faculty permission to create student accounts. Once they add students, create courses, select the class and assign its faculty member. Faculty then record attendance and marks from their own portal.</p><div className="student-actions"><button className="button primary" onClick={()=>navigate('Courses')}>Set up courses</button><button className="button" onClick={()=>navigate('Faculty Permissions')}>Assign student-management permission</button></div></section></>;
}
export default function Dashboard({token}) {
 const [page,setPage]=useState('Dashboard'),[menuOpen,setMenuOpen]=useState(false);
 function navigate(next){setPage(next);setMenuOpen(false);}
 return <div className="app">{menuOpen&&<button className="sidebar-backdrop" aria-label="Close navigation" onClick={()=>setMenuOpen(false)}/>}
 <aside id="sidebar" className={`sidebar ${menuOpen?'open':''}`}><div className="brand"><span className="brand-icon">CC</span><div><strong>CampusConnect</strong><span className="brand-subtitle">COLLEGE PORTAL</span></div></div>
 <nav aria-label="Main navigation">{navigation.map((item,index)=><button key={item} className={`nav-item ${page===item?'active':''}`} aria-current={page===item?'page':undefined} onClick={()=>navigate(item)}><span className="nav-number" aria-hidden="true">{String(index+1).padStart(2,'0')}</span>{item}</button>)}</nav>
 <div className="sidebar-footer"><span className="avatar">AD</span><div><strong>Administrator</strong><small>College records</small></div></div></aside>
 <div className="workspace"><header className="topbar"><div className="header-left"><button className="button menu-button" aria-label="Toggle navigation" aria-controls="sidebar" aria-expanded={menuOpen} onClick={()=>setMenuOpen(!menuOpen)}>☰</button><span className="academic-year">Academic administration</span></div><span className="portal-label">Admin Portal</span></header>
 <main><div className="page-heading"><div><span className="eyebrow">CAMPUSCONNECT</span><h1>{page}</h1><p>Your college’s records and permissions.</p></div></div>
 {page==='Dashboard'&&<Overview token={token} navigate={navigate}/>}
 {page==='Notices'&&<NoticeBoard token={token}/>}
 {page==='Timetable'&&<Timetable token={token} role="admin"/>}
 {page==='College Management'&&<CollegeManagement token={token}/>}
 {page==='Fees'&&<FeesPortal token={token} role="admin"/>}
 {page==='Students'&&<StudentManager token={token} readOnly/>}
 {page==='Faculty Requests'&&<AdminFaculty token={token}/>}
 {page==='Faculty Permissions'&&<FacultyPermissions token={token}/>}
 {['Courses','Attendance','Marks'].includes(page)&&<AcademicPortal key={page} token={token} isAdmin mode={page}/>}
 </main></div></div>;
}
