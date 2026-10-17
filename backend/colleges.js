const express=require('express'),pool=require('./db');const router=express.Router();
const normalize=s=>s.toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]/g,'');
router.get('/',async(req,res,next)=>{try{
 const q=normalize(typeof req.query.search==='string'?req.query.search.trim().slice(0,100):'');
 const live=(await pool.query(`SELECT c.code,c.name,c.directory_code,c.is_active,
 EXISTS(SELECT 1 FROM users u WHERE u.college_id=c.id AND u.role='admin' AND u.status='approved') AS has_admin FROM colleges c`)).rows;
 const directory=(await pool.query('SELECT * FROM college_directory ORDER BY name')).rows;
 const linked=new Set(live.map(c=>c.directory_code||c.code));
 const result=live.map(c=>({code:c.code,name:c.name,directoryCode:c.directory_code,available:c.is_active&&c.has_admin,place:'',status:c.is_active&&c.has_admin?'Available':'Registration required'}));
 for(const d of directory){const existing=result.find(c=>c.directoryCode===d.code||c.code===d.code);if(existing){Object.assign(existing,{place:d.place,district:d.district,source:d.source,sourcePeriod:d.source_period});}else if(!linked.has(d.code))result.push({code:d.code,name:d.name,place:d.place,district:d.district,source:d.source,sourcePeriod:d.source_period,available:false,status:'Registration required'});}
 const filtered=result.filter(c=>!q||normalize([c.code,c.name,c.directoryCode,c.place,c.district].join(' ')).includes(q)).sort((a,b)=>Number(b.available)-Number(a.available)||a.name.localeCompare(b.name));
 const email=process.env.COLLEGE_REGISTRATION_EMAIL?.trim();
 res.set('Cache-Control','no-store').json({colleges:filtered.slice(0,100),truncated:filtered.length>100,total:filtered.length,directoryCount:directory.length,registrationEmail:email&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null});
}catch(e){next(e);}});module.exports=router;
