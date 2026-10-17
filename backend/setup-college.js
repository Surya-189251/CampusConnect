const {parseArgs}=require('node:util'),pool=require('./db');
const {provision}=require('./college-admin-service');
async function main(){
 const {values:v}=parseArgs({options:{code:{type:'string'},name:{type:'string'},'admin-id':{type:'string'},'admin-name':{type:'string'},email:{type:'string'},'directory-code':{type:'string'},'verification-ref':{type:'string'},'replace-admin':{type:'boolean'},'expected-admin':{type:'string'},help:{type:'boolean'}}});
 if(v.help){console.log('node setup-college.js --code CODE --name "College name" --admin-id ADMIN001 --admin-name "Admin name" --email admin@example.edu --directory-code CODE --verification-ref "Checked head authority and email"\nFor replacement add --replace-admin --expected-admin OLD_ID and use a NEW admin ID/email.');return;}
 if(!v['verification-ref']?.trim())throw new Error('Verify the college head request first, then provide --verification-ref "your verification note or email reference".');
 const result=await provision({code:v.code,name:v.name,adminId:v['admin-id'],adminName:v['admin-name'],email:v.email,directoryCode:v['directory-code'],verificationRef:v['verification-ref'],replace:v['replace-admin'],expectedAdmin:v['expected-admin']});
 console.log('College administrator created successfully.');console.log('College:',result.collegeName,'('+result.collegeCode+')');console.log('Login ID:',result.loginId);console.log('The admin can also sign in using their verified email.');console.log('Temporary password:',result.temporaryPassword);console.log('Shown once. Share privately with the administrator, who must change it at first login. No email was sent.');
}
main().catch(e=>{console.error('Setup failed:',e.code==='23505'?'That ID/email or active administrator already exists. Nothing changed.':e.message);process.exitCode=1;}).finally(()=>pool.end());
