const fs=require('node:fs'),path=require('node:path'),pool=require('./db');
(async()=>{const db=await pool.connect();try{
 for(const file of ['20261013-students.sql','20261013-academics.sql','20261014-fees.sql','20261015-campus.sql','20261015-support.sql','20261015-platform.sql']){
  await db.query(fs.readFileSync(path.join(__dirname,'migrations',file),'utf8'));console.log('Applied:',file);
 }
 await require('./seed-directory').seed(db);
 console.log('Campus bundle update applied successfully. Existing records were preserved.');
}catch(e){await db.query('ROLLBACK').catch(()=>{});console.error('Migration failed:',e.message);process.exitCode=1;}finally{db.release();await pool.end();}})().catch(e=>{console.error(e.message);process.exitCode=1;pool.end();});
