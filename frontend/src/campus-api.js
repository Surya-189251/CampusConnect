import {useEffect,useState} from 'react';
export async function campusRequest(token,path,options={}){
 const response=await fetch('http://localhost:5000/api'+path,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(options.body?{body:JSON.stringify(options.body)}:{})});
 const data=await response.json();if(!response.ok)throw new Error(data.message||'The request failed.');return data;
}
export function useCampus(token,path){
 const [data,setData]=useState(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{const c=new AbortController();setData(null);setError('');campusRequest(token,path,{signal:c.signal}).then(setData).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>c.abort();},[token,path,revision]);
 return {data,error,setError,refresh:()=>setRevision(n=>n+1)};
}
export const localDay=()=>new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function localDateTime(value){const d=value?new Date(value):new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
