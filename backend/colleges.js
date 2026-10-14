const express=require('express'),pool=require('./db');const router=express.Router();
router.get('/',async(req,res,next)=>{try{const search=typeof req.query.search==='string'?req.query.search.trim().slice(0,100):'';
 const r=await pool.query(`SELECT c.code,c.name FROM colleges c WHERE c.is_active=TRUE
 AND EXISTS(SELECT 1 FROM users u WHERE u.college_id=c.id AND u.role='admin' AND u.status='approved')
 AND ($1='' OR STRPOS(LOWER(c.code||' '||c.name),LOWER($1))>0) ORDER BY c.name,c.code LIMIT 501`,[search]);
 res.set('Cache-Control','no-store');res.json({colleges:r.rows.slice(0,500),truncated:r.rows.length>500});}catch(e){next(e);}});module.exports=router;
