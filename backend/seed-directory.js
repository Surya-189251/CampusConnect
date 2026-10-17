const rows=require('./data/ap-colleges.json');
async function seed(db){
 await db.query('BEGIN');try{
 for(const r of rows)await db.query(`INSERT INTO college_directory(code,name,place,district,source,source_period,checked_on) VALUES($1,$2,$3,$4,$5,$6,$7)
 ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,place=EXCLUDED.place,district=EXCLUDED.district,source=EXCLUDED.source,source_period=EXCLUDED.source_period,checked_on=EXCLUDED.checked_on`,[r.code,r.name,r.place,r.district,r.source,r.sourcePeriod,r.checkedOn]);
 // Link the original development college without creating a second Vikas account.
 await db.query(`UPDATE colleges SET directory_code='VCTN' WHERE code='VIKAS' AND directory_code IS NULL
 AND LOWER(name) IN ('vikas college of engineering & technology','vikas college of engineering and technology')
 AND NOT EXISTS(SELECT 1 FROM colleges WHERE directory_code='VCTN')`);
 await db.query('COMMIT');console.log('AP directory loaded:',rows.length,'institutions. Directory entries do not activate accounts.');
 }catch(e){await db.query('ROLLBACK');throw e;}
}
module.exports={seed};
