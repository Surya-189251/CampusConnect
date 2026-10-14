const crypto=require('node:crypto');
const unavailable=message=>Object.assign(new Error(message),{status:503});
function config(collegeCode){
 const keyId=process.env.RAZORPAY_KEY_ID||'',secret=process.env.RAZORPAY_KEY_SECRET||'',college=process.env.RAZORPAY_COLLEGE_CODE||'';
 if(!/^rzp_test_[A-Za-z0-9]+$/.test(keyId)||!secret||!college||college.toUpperCase()!==collegeCode.toUpperCase())throw unavailable('Online test checkout is not configured for this college. Configure Razorpay test keys in backend .env. Live keys are not accepted.');
 return {keyId,secret};
}
function ready(collegeCode){try{config(collegeCode);return true;}catch{return false;}}
async function request(collegeCode,endpoint,body){
 const {keyId,secret}=config(collegeCode);
 let response;
 try{response=await fetch('https://api.razorpay.com/v1'+endpoint,{method:body?'POST':'GET',headers:{Authorization:'Basic '+Buffer.from(keyId+':'+secret).toString('base64'),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)});}catch{throw unavailable('Could not reach Razorpay. Check your connection, then check payment status before retrying.');}
 const data=await response.json().catch(()=>null);
 if(!response.ok||!data)throw unavailable('Razorpay could not complete the request. Check your test-key configuration and gateway dashboard.');
 return data;
}
function validSignature(value,message,secret){if(typeof value!=='string'||!/^[a-f0-9]{64}$/i.test(value))return false;const expected=crypto.createHmac('sha256',secret).update(message).digest();return crypto.timingSafeEqual(expected,Buffer.from(value,'hex'));}
module.exports={config,ready,request,validSignature};
