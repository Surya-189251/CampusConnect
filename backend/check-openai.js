require('dotenv').config({path:require('node:path').join(__dirname,'.env'),quiet:true});
const {settings,diagnose,answer}=require('./openai-client');
(async()=>{const {key,model}=settings();console.log('Configured model:',model);console.log('AI enabled:',process.env.OPENAI_ENABLED==='true');
 if(!key||key==='PASTE_YOUR_PRIVATE_API_KEY')throw new Error('Set a valid OPENAI_API_KEY in backend .env. Do not share the key.');
 const r=await fetch('https://api.openai.com/v1/models',{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(20000)});const d=await r.json().catch(()=>({}));
 if(!r.ok){console.log('Model-list check:',r.status,diagnose(r.status,d.error?.code).code);console.log('A restricted key may allow Responses but not model listing. The response test below checks the actual integration.');if(!process.argv.includes('--test'))console.log(diagnose(r.status,d.error?.code).message);}
 else {const ids=(d.data||[]).map(m=>m.id);console.log('Key accepted by model-list endpoint.');console.log('Configured model listed:',ids.includes(model));console.log('Available GPT model IDs:',ids.filter(id=>/^gpt-/.test(id)).sort().join(', ')||'(none)');}
 console.log('Choose a text Responses-compatible model your project can access; update OPENAI_MODEL, then restart the backend. Model listing alone does not confirm Responses permission.');
 if(process.argv.includes('--test')){await answer('Reply with OK only.',[{role:'user',content:'Connection test'}]);console.log('PASS: Responses API returned readable text. This test uses API tokens.');}
 else console.log('To test one actual response (uses API tokens), run: node check-openai.js --test');
})().catch(e=>{console.error(e.status?e.message:e.name==='TimeoutError'?'OpenAI connection timed out.':e.message==='fetch failed'?'Could not connect to OpenAI. Check your network.':e.message);process.exitCode=1;});
