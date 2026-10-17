import {API_BASE} from './api-config';
import { useEffect, useState } from 'react';
import readExcelFile from 'read-excel-file/browser';
import Papa from 'papaparse';
import './Students.css';
const API = `${API_BASE}/students`;
const fields = [
  ['rollNumber','Roll number',['rollnumber','rollno','roll','studentid','regno','registrationnumber']],
  ['fullName','Full name',['fullname','name','studentname']],
  ['email','Email',['email','emailaddress','emailid']],
  ['mobile','Mobile number',['mobile','mobilenumber','mobileno','phone','phonenumber','contactnumber']],
  ['department','Department',['department','branch','dept']],
  ['admissionYear','Admission year',['admissionyear','yearofadmission','joiningyear']],
  ['semester','Semester',['semester','sem']],
  ['section','Section',['section','sec']],
];
const blank = Object.fromEntries(fields.map(([k])=>[k,'']));
const normalize = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g,'');
function downloadCsv(rows, name) {
  const url=URL.createObjectURL(new Blob([Papa.unparse(rows,{escapeFormulae:true})],{type:'text/csv;charset=utf-8;'}));
  const link=document.createElement('a'); link.href=url; link.download=name; link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function StudentManager({token, readOnly = false}) {
  const [form,setForm]=useState(blank);
  const [students,setStudents]=useState([]), [truncated,setTruncated]=useState(false);
  const [search,setSearch]=useState(''), [query,setQuery]=useState(''), [refresh,setRefresh]=useState(0);
  const [loading,setLoading]=useState(true), [busy,setBusy]=useState(false);
  const [error,setError]=useState(''), [message,setMessage]=useState('');
  const [sheets,setSheets]=useState([]), [sheetIndex,setSheetIndex]=useState(0), [mapping,setMapping]=useState({});
  const [preview,setPreview]=useState(null), [credentials,setCredentials]=useState([]);
  const selected=sheets[sheetIndex]?.data || [];
  const headers=selected[0] || [];
  async function request(path, body) {
    const response=await fetch(API+path,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();
    if(!response.ok) throw new Error(data.errors?.join('\n') || data.message || 'Request failed.');
    return data;
  }
  useEffect(()=>{
    const controller=new AbortController();
    fetch(`${API}?search=${encodeURIComponent(query)}`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
      .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.message);return data;})
      .then(data=>{setStudents(data.students);setTruncated(data.truncated);})
      .catch(err=>{if(err.name!=='AbortError'){setError(err.message);setStudents([]);}})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[token,query,refresh]);
  function detect(data) {
    const names=(data[0]||[]).map(normalize);
    setMapping(Object.fromEntries(fields.map(([key,,aliases])=>{
      const matches=names.map((name,i)=>aliases.includes(name)?i:-1).filter(i=>i>=0);
      return [key,matches.length===1?String(matches[0]):''];
    })));
    setPreview(null);
  }
  async function loadFile(event) {
    const file=event.target.files[0]; event.target.value='';
    setError('');setMessage('');setPreview(null);setSheets([]);
    if(!file)return;
    if(file.size>2*1024*1024){setError('Use a file smaller than 2 MB.');return;}
    setBusy(true);
    try {
      let parsed;
      if(/\.xlsx$/i.test(file.name)) parsed=await readExcelFile(file);
      else if(/\.csv$/i.test(file.name)) {
        const csv=Papa.parse(await file.text(),{skipEmptyLines:'greedy'});
        if(csv.errors.length)throw new Error('CSV could not be read. Save it as CSV UTF-8 and try again.');
        parsed=[{sheet:'CSV',data:csv.data}];
      } else throw new Error('Choose an .xlsx or .csv file. Save old .xls files as .xlsx first.');
      parsed=parsed.map(sheet=>({...sheet,data:sheet.data.filter(row=>row.some(cell=>cell!==null && String(cell).trim()!==''))}));
      if(!parsed.length)throw new Error('The file is empty.');
      setSheets(parsed);setSheetIndex(0);detect(parsed[0].data);
    } catch(err){setError(err.message || 'Could not read this file.');}
    finally{setBusy(false);}
  }
  async function validate(rows) {
    setBusy(true);setError('');setMessage('');setPreview(null);
    try{const data=await request('/preview',{students:rows});setPreview(data.students);}
    catch(err){setError(err.message);}
    finally{setBusy(false);}
  }
  function previewImport() {
    const columns=fields.map(([key])=>mapping[key]);
    if(columns.some(x=>x==='' || x===undefined) || new Set(columns).size!==fields.length) {
      setError('Map every required field to a different column.');return;
    }
    validate(selected.slice(1).map(row=>Object.fromEntries(fields.map(([key])=>[key,String(row[Number(mapping[key])]??'')]))));
  }
  async function create() {
    setBusy(true);setError('');setMessage('');
    try {
      const data=await request('',{students:preview});
      setCredentials(data.credentials);setMessage(data.message);setPreview(null);setForm(blank);setSheets([]);
      setLoading(true);setRefresh(x=>x+1);
    } catch(err){setError(`${err.message}\nIf the connection failed, search the directory before retrying. If accounts exist, use Reset password to recover access.`);setPreview(null);}
    finally{setBusy(false);}
  }
  async function reset(student) {
    if(!window.confirm(`Reset password for ${student.login_id}? Their old password and sessions will stop working.`))return;
    setBusy(true);setError('');
    try{const data=await request(`/${student.id}/reset-password`,{});setCredentials(data.credentials);setMessage(data.message);setRefresh(x=>x+1);}
    catch(err){setError(err.message);}
    finally{setBusy(false);}
  }
  const locked=busy || credentials.length>0;
  return <div className="student-manager">
    <section className="panel">
      <h2>Student accounts</h2>
      <p>{readOnly ? "View your college’s student directory here. To add students, assign Manage Student Accounts to an approved faculty member from Faculty Permissions. That faculty member adds or imports students from their own login." : "Accounts belong to your college. Email and mobile are required. Students sign in with their roll number and a temporary password, then choose their own password."}</p>
      {error && <p className="auth-error multiline" role="alert">{error}</p>}
      {message && <p className="auth-success" role="status">{message}</p>}
      {busy && <p role="status">Processing… Large batches can take a minute. Keep this page open.</p>}
      {!readOnly && credentials.length>0 && <div className="credentials-box">
        <h3>Save these temporary passwords now</h3><p>They are shown only for this result. Share each password privately with its student. They are not emailed or sent by SMS.</p>
        <div className="table-scroll"><table><thead><tr><th>Roll number</th><th>Name</th><th>Temporary password</th></tr></thead>
          <tbody>{credentials.map(c=><tr key={c.rollNumber}><td>{c.rollNumber}</td><td>{c.fullName}</td><td><code>{c.temporaryPassword}</code></td></tr>)}</tbody></table></div>
        <div className="student-actions"><button className="button primary" onClick={()=>downloadCsv(credentials,'CampusConnect-private-credentials.csv')}>Download credentials</button>
        <button className="button" onClick={()=>{if(window.confirm('Have you saved or privately delivered these passwords?'))setCredentials([]);}}>I have saved them — hide passwords</button></div>
      </div>}
    </section>
    {!readOnly && <>
    <section className="panel"><h2>Add one student</h2>
      <form onSubmit={event=>{event.preventDefault();validate([form]);}}>
        <fieldset disabled={locked} className="student-fields">
          {fields.map(([key,label])=><label className="auth-field" key={key}><span>{label} *</span>
            <input required value={form[key]} type={key==='email'?'email':'text'} inputMode={['mobile','semester','admissionYear'].includes(key)?'numeric':undefined}
              maxLength={key==='fullName'?120:key==='email'?254:key==='department'?100:key==='section'?20:50}
              onChange={event=>{setForm({...form,[key]:event.target.value});setPreview(null);}} /></label>)}
        </fieldset><button className="button primary" disabled={locked}>Preview student</button>
      </form>
    </section>
    <section className="panel"><h2>Import Excel or CSV</h2>
      <p>Up to 100 students per batch, 2 MB maximum. Put column names in the first row. Format roll numbers and mobile numbers as Text in Excel to preserve their digits.</p>
      <div className="student-actions"><button className="button" onClick={()=>downloadCsv([fields.map(([,label])=>label)],'CampusConnect-student-template.csv')}>Download blank CSV template</button>
        <label className="auth-field"><span>Choose .xlsx or .csv</span><input type="file" accept=".xlsx,.csv" disabled={locked} onChange={loadFile}/></label></div>
      {sheets.length>0 && <fieldset disabled={locked} className="import-controls">
        <label className="auth-field"><span>Worksheet</span><select value={sheetIndex} onChange={event=>{const i=Number(event.target.value);setSheetIndex(i);detect(sheets[i].data);}}>{sheets.map((sheet,i)=><option value={i} key={i}>{sheet.sheet}</option>)}</select></label>
        <p>{Math.max(0,selected.length-1)} student rows found. Check the detected columns below.</p>
        <div className="student-fields">{fields.map(([key,label])=><label className="auth-field" key={key}><span>{label} *</span>
          <select value={mapping[key]??''} onChange={event=>{setMapping({...mapping,[key]:event.target.value});setPreview(null);}}><option value="">Select column</option>
            {headers.map((h,i)=><option key={i} value={i}>{i+1}: {String(h??'(blank)')}</option>)}</select></label>)}</div>
        <button className="button primary" onClick={previewImport}>Validate and preview import</button>
      </fieldset>}
    </section>
    </>}
    {!readOnly && preview && <section className="panel"><h2>Review {preview.length} student account(s)</h2><p>Nothing is saved yet. Check every row, then confirm.</p>
      <div className="table-scroll"><table><thead><tr>{fields.map(([key,label])=><th key={key}>{label}</th>)}</tr></thead><tbody>{preview.map((row,i)=><tr key={i}>{fields.map(([key])=><td key={key}>{row[key]}</td>)}</tr>)}</tbody></table></div>
      <div className="student-actions"><button className="button primary" disabled={locked} onClick={create}>Confirm — create {preview.length} account(s)</button><button className="button" disabled={busy} onClick={()=>setPreview(null)}>Cancel</button></div>
    </section>}
    <section className="panel"><h2>College student directory</h2>
      <form className="student-actions" onSubmit={event=>{event.preventDefault();setLoading(true);setQuery(search);setRefresh(x=>x+1);}}>
        <label className="auth-field"><span>Search name, roll number or department</span><input value={search} onChange={e=>setSearch(e.target.value)} maxLength={100}/></label><button className="button" disabled={busy}>Search / refresh</button>
      </form>
      {loading?<p>Loading students…</p>:<><p>{students.length} records shown.{truncated?' More records exist — narrow your search.':''}</p>
      <div className="table-scroll"><table><thead><tr><th>Roll number</th><th>Name</th><th>Department</th><th>Email</th><th>Mobile</th><th>Year / semester / section</th><th>Access</th>{!readOnly && <th>Action</th>}</tr></thead>
      <tbody>{students.map(s=><tr key={s.id}><td>{s.login_id}</td><td>{s.full_name}</td><td>{s.department}</td><td>{s.email}</td><td>{s.mobile||'Not recorded'}</td><td>{s.admission_year} / {s.semester} / {s.section}</td><td>{s.status}{s.must_change_password?' · password change required':''}</td>{!readOnly && <td><button className="button small" disabled={locked||s.status!=='approved'} onClick={()=>reset(s)}>Reset password</button></td>}</tr>)}</tbody></table></div>
      {!students.length && <p>No matching student accounts.</p>}</>}
    </section>
  </div>;
}
