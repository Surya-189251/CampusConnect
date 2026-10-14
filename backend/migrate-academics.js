const fs=require('node:fs');
const path=require('node:path');
const pool=require('./db');
(async()=>{
 const client=await pool.connect();
 try {
  await client.query(fs.readFileSync(path.join(__dirname,'migrations/20261013-academics.sql'),'utf8'));
  console.log('Academic modules update applied successfully. Existing data was preserved.');
 } catch(error) {
  await client.query('ROLLBACK').catch(()=>{}); console.error('Migration failed:',error.message);process.exitCode=1;
 } finally {client.release();await pool.end();}
})().catch(error=>{console.error(error.message);process.exitCode=1;pool.end();});
