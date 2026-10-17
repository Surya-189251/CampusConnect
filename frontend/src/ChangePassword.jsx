import {API_BASE} from './api-config';
import { useState } from 'react';
export default function ChangePassword({token,onComplete,requiredChange=true,onCancel}) {
  const [currentPassword,setCurrent]=useState(''),[newPassword,setNew]=useState(''),[confirm,setConfirm]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function submit(event) {
    event.preventDefault();setError('');
    if(newPassword!==confirm){setError('New passwords do not match.');return;}
    setBusy(true);
    try {
      const response=await fetch(`${API_BASE}/auth/change-password`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({currentPassword,newPassword})});
      const data=await response.json();if(!response.ok)throw new Error(data.message);
      onComplete();
    } catch(err){setError(err.message || 'Could not update password.');}finally{setBusy(false);}
  }
  return <main className="auth-page"><section className="auth-card"><h1>{requiredChange?'Set your password':'Change your password'}</h1><p>{requiredChange?'Replace your temporary password before using your account.':'Choose a new private password.'} All your sessions will end and you will sign in again.</p>
    <form onSubmit={submit}><fieldset disabled={busy} style={{border:0,padding:0}}>
      <label className="auth-field"><span>{requiredChange?'Temporary password':'Current password'}</span><input type="password" required autoComplete="current-password" value={currentPassword} onChange={e=>setCurrent(e.target.value)}/></label>
      <label className="auth-field"><span>New password (at least 12 characters)</span><input type="password" minLength={12} required autoComplete="new-password" value={newPassword} onChange={e=>setNew(e.target.value)}/></label>
      <label className="auth-field"><span>Confirm new password</span><input type="password" minLength={12} required autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
      {error&&<p className="auth-error" role="alert">{error}</p>}<button className="auth-button submit">{busy?'Updating…':'Save password and return to login'}</button>
    {!requiredChange&&<button type="button" className="auth-button secondary" onClick={onCancel}>Cancel</button>}</fieldset></form></section></main>;
}
