function settings(){return {key:process.env.OPENAI_API_KEY?.trim()||'',model:process.env.OPENAI_MODEL?.trim()||'gpt-5.6-terra'};}
function diagnose(status,code){
 if(status===401)return {code:'invalid_api_key',message:'OpenAI rejected the API key. The server owner needs to replace it in backend .env and restart.'};
 if(status===404||code==='model_not_found')return {code:'model_access',message:'The configured AI model is unavailable to this API project. Ask the server owner to run node check-openai.js and choose an accessible model.'};
 if(status===403)return {code:'permission_denied',message:'OpenAI denied this project or key access. The server owner needs to check project permissions and model access.'};
 if(status===429)return {code:code==='insufficient_quota'?'insufficient_quota':'rate_limited',message:code==='insufficient_quota'?'This OpenAI API project has no available quota. The server owner needs to check API billing and credits.':'OpenAI is rate limiting this project. Wait and retry.'};
 if(status===400)return {code:'invalid_request',message:'OpenAI rejected the model settings. Ask the server owner to run node check-openai.js --test.'};
 return {code:'provider_unavailable',message:'AI is temporarily unavailable. Please try again later.'};
}
async function answer(instructions,messages){const c=settings();let r;
 try{r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+c.key,'Content-Type':'application/json'},body:JSON.stringify({model:c.model,instructions,input:messages,max_output_tokens:1500,store:false,...(c.model==='gpt-5.6-terra'?{reasoning:{effort:'none'}}:{})}),signal:AbortSignal.timeout(45000)});}catch{throw Object.assign(new Error('OpenAI could not be reached. Retry later.'),{status:503,code:'network_error'});}
 const d=await r.json().catch(()=>null);if(!r.ok){const issue=diagnose(r.status,d?.error?.code);console.error('OpenAI request failed:',r.status,issue.code);throw Object.assign(new Error(issue.message),{status:503,code:issue.code});}
 const text=(d?.output||[]).filter(x=>x.type==='message'&&x.role==='assistant').flatMap(x=>x.content||[]).map(x=>x.type==='output_text'?x.text:x.type==='refusal'?x.refusal:'').filter(x=>typeof x==='string').join('\n').trim();
 if(!text)throw Object.assign(new Error('AI returned no readable answer. Retry with a shorter question.'),{status:503,code:'empty_answer'});
 return {answer:text.slice(0,6000),incomplete:d.status==='incomplete'||text.length>6000};
}
module.exports={settings,diagnose,answer};
