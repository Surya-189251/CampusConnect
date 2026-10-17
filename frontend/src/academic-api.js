import {API_BASE} from './api-config';
export async function academicRequest(token,path,{method='GET',body,signal}={}) {
 const response=await fetch(`${API_BASE}/academics${path}`,{
  method,signal,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{}),
 });
 let data;try{data=await response.json();}catch{throw new Error('The server returned an unreadable response. Check the backend.');}
 if(!response.ok)throw new Error(data.message||'Request failed.');return data;
}
export function collegeToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
