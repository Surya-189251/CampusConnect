import NoticeBoard from './NoticeBoard';
import Timetable from './Timetable';
import FeesPortal from "./FeesPortal";
import {useState} from 'react';
import AcademicPortal from './AcademicPortal';
import StudentManager from './StudentManager';
export default function FacultyDashboard({token,user}) {
 const [page,setPage]=useState('Courses');
 const tabs=['Notices','Timetable','Courses','Attendance','Marks',...(user.permissions?.includes('students.manage')?['Student Accounts']:[]),...(user.permissions?.some(p=>['fees.manage','payments.view','payments.record_offline'].includes(p))?['Fees']:[])];
 return <main className="staff-workspace"><h1>Faculty workspace</h1><p>View your college’s academic records. You can enter attendance and marks only for classes assigned to you.</p>
  <nav className="academic-tabs" aria-label="Faculty modules">{tabs.map(tab=><button key={tab} className={`button ${page===tab?'primary':''}`} aria-current={page===tab?'page':undefined} onClick={()=>setPage(tab)}>{tab}</button>)}</nav>
  {page==='Notices'?<NoticeBoard token={token}/>:page==='Timetable'?<Timetable token={token} role="faculty"/>:page==='Fees'?<FeesPortal token={token} role="faculty"/>:page==='Student Accounts'?<StudentManager token={token}/>:<AcademicPortal key={page} token={token} mode={page}/>}
 </main>;
}
