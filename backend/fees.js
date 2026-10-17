const express=require('express'),crypto=require('node:crypto'),pool=require('./db');
const {requireAuth}=require('./auth');
const router=express.Router();const fail=(status,message)=>Object.assign(new Error(message),{status});
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}};
function id(v){const n=Number(v);if(!Number.isSafeInteger(n)||n<1||n>2147483647)throw fail(400,'Invalid record ID.');return n;}
function str(v,max,label){if(typeof v!=='string'||!v.trim()||v.trim().length>max)throw fail(400,`${label} is required (maximum ${max} characters).`);return v.trim();}
function uuid(v){if(typeof v!=='string'||!/^\w{8}-\w{4}-4\w{3}-[89ab]\w{3}-\w{12}$/i.test(v)||!/^[a-f0-9-]+$/i.test(v))throw fail(400,'Invalid request identifier.');return v;}
function money(v,minimum=100){if(typeof v!=='string'||!/^\d{1,7}(\.\d{1,2})?$/.test(v.trim()))throw fail(400,'Enter a rupee amount with at most two decimals.');const [whole,fraction='']=v.trim().split('.');const n=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(n<minimum||n>100000000)throw fail(400,`Amount must be at least ${minimum===1?'₹0.01':'₹1'} and at most ₹10,00,000.`);return n;}
function date(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw fail(400,'Choose a valid due date.');return v;}
async function tx(fn){const db=await pool.connect();try{await db.query('BEGIN');const value=await fn(db);await db.query('COMMIT');return value;}catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}}
async function permission(db,user,code,lock=false){
 const r=await db.query(`SELECT role FROM users WHERE id=$1 AND college_id=$2 AND status='approved' AND must_change_password=FALSE ${lock?'FOR UPDATE':''}`,[user.id,user.college_id]);
 if(r.rows[0]?.role!=='faculty')throw fail(403,'This action requires an authorised faculty account.');
 const p=await db.query('SELECT 1 FROM user_permissions WHERE user_id=$1 AND permission_code=$2',[user.id,code]);if(!p.rowCount)throw fail(403,'Your administrator has not granted the required fee/payment permission.');
}
async function audit(db,user,action,target,details){await db.query("INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,details) VALUES($1,$2,'fee_invoice',$3,$4::jsonb)",[user?.id||null,action,String(target),JSON.stringify(details||{})]);}
async function invoice(db,invoiceId,collegeId,lock=false){const r=await db.query(`SELECT i.*,c.code AS college_code,c.name AS college_name,u.full_name,u.login_id FROM fee_invoices i JOIN colleges c ON c.id=i.college_id JOIN users u ON u.id=i.student_id WHERE i.id=$1 AND i.college_id=$2 ${lock?'FOR UPDATE OF i':''}`,[id(invoiceId),collegeId]);if(!r.rows[0])throw fail(404,'Fee not found in your college.');return r.rows[0];}
async function balance(db,i){const r=await db.query('SELECT COALESCE(SUM(amount_paise-refunded_paise),0)::integer AS paid FROM fee_payments WHERE invoice_id=$1',[i.id]);return {paid:r.rows[0].paid,due:Math.max(0,i.amount_paise-r.rows[0].paid)};}
async function staffRead(req){if(req.user.role==='admin')return;if(req.user.role!=='faculty'||!req.feePermissions.length)throw fail(403,'Fee access requires an assigned permission.');}
function studentOwn(req,i){if(req.user.role!=='student'||i.student_id!==req.user.id)throw fail(403,'You can view only your own fees.');}
const officeMessage='Online payment of fees still not assigned. Please pay at the Administrator Office.';
async function webhook(req,res){res.status(503).json({message:officeMessage});}
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});router.use(requireAuth);
router.use(async(req,res,next)=>{try{const p=await pool.query("SELECT permission_code FROM user_permissions WHERE user_id=$1 AND permission_code IN ('fees.manage','payments.view','payments.record_offline')",[req.user.id]);req.feePermissions=p.rows.map(x=>x.permission_code);next();}catch(e){next(e);}});
router.get('/config',wrap(async(req,res)=>res.json({mode:'office',onlineReady:false,officeMessage,permissions:req.feePermissions})));
router.post(['/invoices/:id/order','/verify','/invoices/:id/sync'],(req,res)=>res.status(503).json({message:officeMessage}));
router.get('/invoices',wrap(async(req,res)=>{
 if(req.user.role!=='student')await staffRead(req);
 const search=typeof req.query.search==='string'?req.query.search.trim().slice(0,100):'';
 const r=await pool.query(`SELECT i.*,i.due_date::text AS due_date,u.full_name,u.login_id,
 COALESCE(p.paid,0)::integer AS paid_paise,CASE WHEN i.status='void' THEN 0 ELSE GREATEST(0,i.amount_paise-COALESCE(p.paid,0))::integer END AS balance_paise,
 GREATEST(0,COALESCE(p.paid,0)-i.amount_paise)::integer AS credit_paise,
 EXISTS(SELECT 1 FROM fee_orders o WHERE o.invoice_id=i.id AND o.state='open') AS has_open_order
 FROM fee_invoices i JOIN users u ON u.id=i.student_id
 LEFT JOIN (SELECT invoice_id,SUM(amount_paise-refunded_paise) AS paid FROM fee_payments GROUP BY invoice_id) p ON p.invoice_id=i.id
 WHERE i.college_id=$1 AND i.mode='office' AND ($2::integer IS NULL OR i.student_id=$2)
 AND ($3='' OR STRPOS(LOWER(u.login_id||' '||u.full_name||' '||i.title),LOWER($3))>0)
 ORDER BY i.created_at DESC,i.id DESC LIMIT 201`,[req.user.college_id,req.user.role==='student'?req.user.id:null,search]);
 res.json({invoices:r.rows.slice(0,200),truncated:r.rows.length>200});
}));
router.get('/students',wrap(async(req,res)=>{await permission(pool,req.user,'fees.manage');const q=typeof req.query.search==='string'?req.query.search.trim().slice(0,100):'';
 const r=await pool.query(`SELECT u.id,u.login_id,u.full_name,p.department,p.admission_year,p.semester,p.section FROM users u JOIN student_profiles p ON p.user_id=u.id WHERE u.college_id=$1 AND u.role='student' AND u.status='approved' AND ($2='' OR STRPOS(LOWER(u.login_id||' '||u.full_name||' '||p.department||' '||p.section),LOWER($2))>0) ORDER BY u.login_id LIMIT 201`,[req.user.college_id,q]);res.json({students:r.rows.slice(0,200),truncated:r.rows.length>200});}));
router.post('/invoices',wrap(async(req,res)=>{
 const b=req.body||{},title=str(b.title,120,'Fee title'),year=str(b.academicYear,9,'Academic year'),due=date(b.dueDate),amount=money(b.amount);
 if(!/^\d{4}-\d{4}$/.test(year)||+year.slice(5)!==+year.slice(0,4)+1)throw fail(400,'Use an academic year such as 2026-2027.');
 if(!Array.isArray(b.studentIds)||!b.studentIds.length||b.studentIds.length>200)throw fail(400,'Select 1–200 students.');const ids=b.studentIds.map(id);if(new Set(ids).size!==ids.length)throw fail(400,'Duplicate students selected.');
 await tx(async db=>{await permission(db,req.user,'fees.manage',true);
  const valid=await db.query("SELECT id FROM users WHERE id=ANY($1::integer[]) AND college_id=$2 AND role='student' AND status='approved'",[ids,req.user.college_id]);if(valid.rowCount!==ids.length)throw fail(400,'All selected students must be approved accounts in your college.');
  for(const studentId of ids){const r=await db.query('INSERT INTO fee_invoices(college_id,student_id,title,academic_year,due_date,amount_paise,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[req.user.college_id,studentId,title,year,due,amount,req.user.id]);await audit(db,req.user,'fee.assigned',r.rows[0].id,{amountPaise:amount,studentId,mode:'office'});}
 });res.status(201).json({message:`Assigned fee to ${ids.length} student(s).`});
}));
router.patch('/invoices/:id',wrap(async(req,res)=>{
 const b=req.body||{};const version=id(b.version);
 await tx(async db=>{await permission(db,req.user,'fees.manage',true);const i=await invoice(db,req.params.id,req.user.college_id,true);
  if(i.mode!=='office')throw fail(409,'Legacy test fees are read-only.');
  if(i.status!=='active'||i.version!==version)throw fail(409,'Fee changed. Refresh before editing.');
  const paid=await balance(db,i);if(b.action==='void'&&paid.paid>0)throw fail(409,'Reverse recorded office payments before voiding this fee.');
  if(b.action==='void'){await db.query("UPDATE fee_invoices SET status='void',version=version+1 WHERE id=$1",[i.id]);await audit(db,req.user,'fee.voided',i.id,{reason:str(b.reason,300,'Reason')});}
  else if(b.action==='edit'){const amount=money(b.amount),due=date(b.dueDate);if(amount<paid.paid)throw fail(409,'Fee amount cannot be lower than net paid.');await db.query('UPDATE fee_invoices SET amount_paise=$1,due_date=$2,version=version+1 WHERE id=$3',[amount,due,i.id]);await audit(db,req.user,'fee.edited',i.id,{previousAmountPaise:i.amount_paise,amountPaise:amount,dueDate:due});}
  else throw fail(400,'Choose edit or void.');
 });res.json({message:'Fee updated.'});
}));
router.get('/invoices/:id/payments',wrap(async(req,res)=>{
 const i=await invoice(pool,req.params.id,req.user.college_id);
 if(req.user.role==='student'){studentOwn(req,i);if(i.mode!=='office')throw fail(404,'Fee not found.');}else if(req.user.role!=='admin')await permission(pool,req.user,'payments.view');
 const r=await pool.query('SELECT * FROM fee_payments WHERE invoice_id=$1 ORDER BY paid_at DESC',[i.id]);res.json({payments:r.rows});
}));
router.post('/invoices/:id/offline',wrap(async(req,res)=>{
 const b=req.body||{},amount=money(b.amount,1),reference=str(b.reference,100,'Offline reference'),key=uuid(b.idempotencyKey);
 if(!['cash','bank_transfer','cheque'].includes(b.method))throw fail(400,'Select an offline payment method.');
 const result=await tx(async db=>{await permission(db,req.user,'payments.record_offline',true);const i=await invoice(db,req.params.id,req.user.college_id,true);
  const old=(await db.query('SELECT * FROM fee_payments WHERE college_id=$1 AND idempotency_key=$2',[i.college_id,key])).rows[0];
  if(old){if(old.invoice_id!==i.id||old.amount_paise!==amount||old.reference!==reference||old.method!==b.method||old.recorded_by!==req.user.id)throw fail(409,'Request ID was already used for a different payment.');return old;}
  if(i.mode!=='office')throw fail(409,'Legacy test fees are read-only.');
  if(i.status!=='active')throw fail(409,'This fee is void.');
  
  const remaining=await balance(db,i);if(amount>remaining.due)throw fail(409,'Payment exceeds the outstanding balance. Refresh the fee.');
  const pid=crypto.randomUUID();const r=await db.query(`INSERT INTO fee_payments(id,receipt_number,invoice_id,college_id,kind,amount_paise,method,reference,idempotency_key,recorded_by)
  VALUES($1,$2,$3,$4,'offline',$5,$6,$7,$8,$9) RETURNING *`,[pid,'CC-OFFICE-'+pid,i.id,i.college_id,amount,b.method,reference,key,req.user.id]);await audit(db,req.user,'payment.offline_recorded',i.id,{paymentId:pid,amountPaise:amount,reference,mode:'office'});return r.rows[0];
 });res.json({message:'Office payment recorded. No money was transferred by the app.',payment:result});
}));
router.post('/payments/:id/reverse',wrap(async(req,res)=>{
 const reason=str(req.body?.reason,300,'Reversal reason');
 await tx(async db=>{await permission(db,req.user,'payments.record_offline',true);const found=(await db.query("SELECT invoice_id FROM fee_payments WHERE id=$1 AND college_id=$2 AND kind='offline'",[uuid(req.params.id),req.user.college_id])).rows[0];if(!found)throw fail(404,'Offline payment not found.');
  const i=await invoice(db,found.invoice_id,req.user.college_id,true);if(i.mode!=='office')throw fail(409,'Legacy test fees are read-only.');const p=(await db.query('SELECT * FROM fee_payments WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
  if(p.refunded_paise!==p.amount_paise){await db.query('UPDATE fee_payments SET refunded_paise=amount_paise,updated_at=NOW() WHERE id=$1',[p.id]);await audit(db,req.user,'payment.offline_reversed',i.id,{paymentId:p.id,reason});}
 });res.json({message:'Office payment entry reversed. History was preserved.'});
}));
router.get('/payments/:id/receipt',wrap(async(req,res)=>{
 const p=(await pool.query('SELECT * FROM fee_payments WHERE id=$1 AND college_id=$2',[uuid(req.params.id),req.user.college_id])).rows[0];if(!p)throw fail(404,'Receipt not found.');const i=await invoice(pool,p.invoice_id,req.user.college_id);
 if(req.user.role==='student'){studentOwn(req,i);if(i.mode!=='office')throw fail(404,'Fee not found.');}else if(req.user.role!=='admin')await permission(pool,req.user,'payments.view');
 res.json({mode:i.mode,payment:p,invoice:{id:i.id,title:i.title,academicYear:i.academic_year,studentName:i.full_name,rollNumber:i.login_id,collegeName:i.college_name}});
}));
function importRows(input){
 if(!Array.isArray(input)||!input.length||input.length>200)throw fail(400,'Import 1–200 rows at a time.');
 const seen=new Set();return input.map((r,n)=>{try{
 const rollNumber=str(r.rollNumber,50,'Roll number'),title=str(r.title,120,'Fee title'),academicYear=str(r.academicYear,9,'Academic year');
 if(!/^\d{4}-\d{4}$/.test(academicYear)||+academicYear.slice(5)!==+academicYear.slice(0,4)+1)throw fail(400,'Use an academic year such as 2026-2027.');
 const dueDate=date(r.dueDate),amount=money(String(r.amount));const paid=r.paidAmount==null||String(r.paidAmount).trim()===''?null:money(String(r.paidAmount),0);
 if(paid!==null&&paid>amount)throw fail(400,'Paid amount cannot exceed the fee amount.');
 const key=[rollNumber.toLowerCase(),title.toLowerCase(),academicYear].join('|');if(seen.has(key))throw fail(400,'Duplicate student, fee title and year in this file.');seen.add(key);
 return {rollNumber,title,academicYear,dueDate,amount,paid,reference:r.reference?str(r.reference,100,'Office reference'):'',method:r.method?str(r.method,30,'Payment method'):'cash'};
 }catch(e){throw fail(400,`Row ${n+2}: ${e.message}`);}});
}
async function previewImport(db,user,rows,lock=false){
 await permission(db,user,'fees.manage',lock);
 if(rows.some(r=>r.paid>0))await permission(db,user,'payments.record_offline');
 const plans=[];
 for(let n=0;n<rows.length;n++){const r=rows[n];try{
 const student=(await db.query("SELECT id,full_name FROM users WHERE college_id=$1 AND LOWER(login_id)=LOWER($2) AND role='student' AND status='approved'",[user.college_id,r.rollNumber])).rows[0];if(!student)throw fail(400,'No approved student with this roll number in your college.');
 const existing=(await db.query(`SELECT * FROM fee_invoices WHERE college_id=$1 AND student_id=$2 AND LOWER(title)=LOWER($3) AND academic_year=$4 AND status='active' AND mode='office' ${lock?'FOR UPDATE':''}`,[user.college_id,student.id,r.title,r.academicYear])).rows[0];
 const paid=existing?(await balance(db,existing)).paid:0,target=r.paid===null?paid:r.paid;
 if(target<paid)throw fail(409,'Paid total is lower than recorded payments. Reverse an incorrect entry individually first.');
 if(r.amount<target)throw fail(400,'Fee amount is lower than paid total.');
 const payment=target-paid;
 if(payment){if(!r.reference)throw fail(400,'An office receipt/reference is required for an increase in paid total.');if(!['cash','bank_transfer','cheque'].includes(r.method))throw fail(400,'Payment method must be cash, bank_transfer or cheque.');
 const duplicate=await db.query("SELECT 1 FROM fee_payments WHERE college_id=$1 AND LOWER(reference)=LOWER($2) AND kind='offline'",[user.college_id,r.reference]);if(duplicate.rowCount)throw fail(409,'Office reference already exists.');if(plans.some(p=>p.payment>0&&p.reference.toLowerCase()===r.reference.toLowerCase()))throw fail(400,'Duplicate office reference in this file.');}
 plans.push({...r,studentId:student.id,studentName:student.full_name,invoiceId:existing?.id||null,version:existing?.version||null,previousAmount:existing?.amount_paise||0,previousPaid:paid,targetPaid:target,payment,action:existing?'Update':'Create'});
 }catch(e){throw fail(e.status||400,`Row ${n+2}: ${e.message}`);}}
 return {plans,fingerprint:crypto.createHash('sha256').update(JSON.stringify(plans)).digest('hex')};
}
router.post('/import/preview',wrap(async(req,res)=>{const rows=importRows(req.body?.rows);res.json(await previewImport(pool,req.user,rows));}));
router.post('/import',wrap(async(req,res)=>{
 const rows=importRows(req.body?.rows),key=uuid(req.body?.requestKey),fingerprint=str(req.body?.fingerprint,64,'Preview fingerprint');
 const bodyHash=crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
 const result=await tx(async db=>{
 await permission(db,req.user,'fees.manage',true);
 await db.query('SELECT id FROM colleges WHERE id=$1 FOR UPDATE',[req.user.college_id]);
 const previous=(await db.query('SELECT * FROM fee_import_batches WHERE id=$1',[key])).rows[0];
 if(previous){if(previous.user_id!==req.user.id||previous.college_id!==req.user.college_id||previous.fingerprint!==bodyHash)throw fail(409,'Import request already used.');return previous.result;}
 const preview=await previewImport(db,req.user,rows,true);if(preview.fingerprint!==fingerprint)throw fail(409,'Records changed since preview. Preview the file again before saving.');
 for(const r of preview.plans){let invoiceId=r.invoiceId;
 if(invoiceId)await db.query('UPDATE fee_invoices SET amount_paise=$1,due_date=$2,version=version+1 WHERE id=$3',[r.amount,r.dueDate,invoiceId]);
 else invoiceId=(await db.query(`INSERT INTO fee_invoices(college_id,student_id,title,academic_year,due_date,amount_paise,created_by,mode) VALUES($1,$2,$3,$4,$5,$6,$7,'office') RETURNING id`,[req.user.college_id,r.studentId,r.title,r.academicYear,r.dueDate,r.amount,req.user.id])).rows[0].id;
 if(r.payment){const pid=crypto.randomUUID();await db.query(`INSERT INTO fee_payments(id,receipt_number,invoice_id,college_id,kind,amount_paise,method,reference,idempotency_key,recorded_by) VALUES($1,$2,$3,$4,'offline',$5,$6,$7,$8,$9)`,[pid,'CC-OFFICE-'+pid,invoiceId,req.user.college_id,r.payment,r.method,r.reference,crypto.randomUUID(),req.user.id]);}
 await audit(db,req.user,'fee.imported',invoiceId,{batchId:key,previousAmount:r.previousAmount,amount:r.amount,previousPaid:r.previousPaid,addedPayment:r.payment});
 }
 const result={message:`Saved ${rows.length} fee row(s). Office payments were recorded; no money was transferred.`};
 await db.query('INSERT INTO fee_import_batches(id,college_id,user_id,fingerprint,result) VALUES($1,$2,$3,$4,$5::jsonb)',[key,req.user.college_id,req.user.id,bodyHash,JSON.stringify(result)]);return result;
 });res.json(result);
}));

router.use((e,req,res,next)=>{if(e.status)return res.status(e.status).json({message:e.message});if(e.code==='23505')return res.status(409).json({message:'This fee, payment reference or request already exists. No duplicate entry was added. Refresh and check the records.'});next(e);});
module.exports={router,webhook};
