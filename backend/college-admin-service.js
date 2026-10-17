const crypto=require('node:crypto'),bcrypt=require('bcryptjs');
const {text,fail,transaction,audit}=require('./campus-utils');
async function provision(options){
 const code=text(options.code,30,'College code').toUpperCase();
 if(!/^[A-Z0-9_-]+$/.test(code))throw fail(400,'College code allows letters, numbers, underscores and hyphens.');
 const name=text(options.name,200,'College name'),loginId=text(options.adminId,50,'Admin login ID'),fullName=text(options.adminName,120,'Admin name');
 const email=text(options.email,254,'Admin email').toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw fail(400,'Enter a valid admin email.');
 const password=crypto.randomBytes(18).toString('base64url'),hash=await bcrypt.hash(password,12);
 return transaction(async db=>{
  const directoryCode=options.directoryCode?.trim().toUpperCase()||null;
  if(directoryCode&&!(await db.query('SELECT 1 FROM college_directory WHERE code=$1',[directoryCode])).rowCount)throw fail(400,'Unknown directory code.');
  await db.query('LOCK TABLE colleges IN SHARE ROW EXCLUSIVE MODE');
  let c=(await db.query('SELECT * FROM colleges WHERE LOWER(code)=LOWER($1) FOR UPDATE',[code])).rows[0];
  if(options.replace && !c)throw fail(404,'Replacement requires an existing college.');
  if(c && (!c.is_active || c.name!==name))throw fail(400,'Use the exact existing college name and an active college.');
  if(!c)c=(await db.query('INSERT INTO colleges(code,name) VALUES($1,$2) RETURNING *',[code,name])).rows[0];
  const old=(await db.query("SELECT id,login_id FROM users WHERE college_id=$1 AND role='admin' AND status='approved' FOR UPDATE",[c.id])).rows;
  if(old.length>1)throw fail(409,'Multiple active admins exist. Resolve this before provisioning.');
  if(options.replace){
   if(old.length!==1||old[0].login_id.toLowerCase()!==String(options.expectedAdmin||'').trim().toLowerCase())throw fail(409,'Current admin ID does not match --expected-admin. Nothing changed.');
   await db.query("UPDATE users SET status='disabled',updated_at=NOW() WHERE id=$1",[old[0].id]);
   await db.query('DELETE FROM sessions WHERE user_id=$1',[old[0].id]);
  }else if(old.length)throw fail(409,'This college already has an active admin. Use the explicit replacement command if a handover is intended.');
  if(directoryCode)await db.query('UPDATE colleges SET directory_code=$1 WHERE id=$2',[directoryCode,c.id]);
  const u=(await db.query("INSERT INTO users(college_id,login_id,full_name,email,password_hash,role,status,must_change_password) VALUES($1,$2,$3,$4,$5,'admin','approved',TRUE) RETURNING id",[c.id,loginId,fullName,email,hash])).rows[0];
  await audit(db,{college_id:c.id},options.replace?'college.admin_replaced':'college.admin_created','user',u.id,{previousAdminId:old[0]?.id||null,newAdminId:u.id,verifiedEmail:email,verificationRef:options.verificationRef||null,directoryCode});
  return {collegeCode:c.code,collegeName:c.name,loginId,temporaryPassword:password};
 });
}
async function setVerifiedEmail(options){
 const code=text(options.code,30,'College code').toUpperCase(),expected=text(options.expectedAdmin,50,'Existing admin ID'),email=text(options.email,254,'Admin email').toLowerCase(),verificationRef=text(options.verificationRef,300,'Verification reference');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw fail(400,'Enter a valid email.');
 return transaction(async db=>{
 const c=(await db.query('SELECT * FROM colleges WHERE code=$1 AND is_active=TRUE FOR UPDATE',[code])).rows[0];if(!c)throw fail(404,'Active college not found.');
 const u=(await db.query("SELECT * FROM users WHERE college_id=$1 AND role='admin' AND status='approved' FOR UPDATE",[c.id])).rows[0];if(!u||u.login_id.toLowerCase()!==expected.toLowerCase())throw fail(409,'Existing admin ID does not match. Nothing changed.');
 await db.query('UPDATE users SET email=$1,updated_at=NOW() WHERE id=$2',[email,u.id]);await db.query('DELETE FROM sessions WHERE user_id=$1',[u.id]);
 await audit(db,{college_id:c.id},'college.admin_email_verified','user',u.id,{verificationRef});return {collegeCode:code,loginId:u.login_id,email};
 });
}
module.exports={provision,setVerifiedEmail};
