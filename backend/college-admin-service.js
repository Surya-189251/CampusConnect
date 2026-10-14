const crypto=require('node:crypto'),bcrypt=require('bcryptjs');
const {text,fail,transaction,audit}=require('./campus-utils');
async function provision(options){
 const code=text(options.code,30,'College code').toUpperCase();
 if(!/^[A-Z0-9_-]+$/.test(code))throw fail(400,'College code allows letters, numbers, underscores and hyphens.');
 const name=text(options.name,200,'College name'),loginId=text(options.adminId,50,'Admin login ID'),fullName=text(options.adminName,120,'Admin name');
 const email=text(options.email,254,'Admin email').toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw fail(400,'Enter a valid admin email.');
 const password=crypto.randomBytes(18).toString('base64url'),hash=await bcrypt.hash(password,12);
 return transaction(async db=>{
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
  const u=(await db.query("INSERT INTO users(college_id,login_id,full_name,email,password_hash,role,status,must_change_password) VALUES($1,$2,$3,$4,$5,'admin','approved',TRUE) RETURNING id",[c.id,loginId,fullName,email,hash])).rows[0];
  await audit(db,{college_id:c.id},options.replace?'college.admin_replaced':'college.admin_created','user',u.id,{previousAdminId:old[0]?.id||null,newAdminId:u.id});
  return {collegeCode:c.code,collegeName:c.name,loginId,temporaryPassword:password};
 });
}
module.exports={provision};
