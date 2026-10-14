const express=require('express'),crypto=require('node:crypto'),pool=require('./db'),gateway=require('./payment-gateway');
const {requireAuth}=require('./auth');const {rateLimit}=require('express-rate-limit');
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
function studentOwn(req,i){if(req.user.role!=='student'||i.student_id!==req.user.id)throw fail(403,'You can pay only your own fees.');}
function providerId(value,prefix){if(typeof value!=='string'||!new RegExp('^'+prefix+'_[A-Za-z0-9]+$').test(value))throw fail(400,'Invalid gateway identifier.');return value;}
async function applyPayment(orderId,paymentId){
 return tx(async db=>{
  const lookup=await db.query('SELECT invoice_id,college_id FROM fee_orders WHERE id=$1',[uuid(orderId)]);if(!lookup.rowCount)throw fail(404,'Payment order not found.');
  const i=await invoice(db,lookup.rows[0].invoice_id,lookup.rows[0].college_id,true);
  const order=(await db.query('SELECT * FROM fee_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
  const cfg=gateway.config(i.college_code);if(order.key_id!==cfg.keyId)throw fail(503,'This order belongs to a different test key. Restore the original key configuration.');
  const p=await gateway.request(i.college_code,'/payments/'+providerId(paymentId,'pay'));
  if(p.id!==paymentId||p.order_id!==order.gateway_order_id||p.currency!=='INR'||p.amount!==order.amount_paise)throw fail(400,'Gateway payment details do not match this saved fee order.');
  if(!['captured','refunded'].includes(p.status)||p.captured!==true)return {settled:false,message:'Payment is not captured yet. Check payment status again after capture.'};
  const refunded=p.amount_refunded??0;if(!Number.isSafeInteger(refunded)||refunded<0||refunded>p.amount)throw fail(502,'Invalid gateway refund amount.');
  const existing=await db.query('SELECT * FROM fee_payments WHERE order_id=$1',[order.id]);
  let receipt;
  if(existing.rowCount){const old=existing.rows[0];if(old.gateway_payment_id!==paymentId)throw fail(409,'A different payment is already recorded for this order. Review it in the gateway dashboard.');receipt=old.receipt_number;
   if(refunded>old.refunded_paise){await db.query('UPDATE fee_payments SET refunded_paise=$1,updated_at=NOW() WHERE id=$2',[refunded,old.id]);await audit(db,null,'payment.refund_synced',i.id,{paymentId,refundedPaise:refunded});}
  }else{
   const paymentUuid=crypto.randomUUID();receipt='CC-TEST-'+paymentUuid;
   await db.query(`INSERT INTO fee_payments(id,receipt_number,invoice_id,college_id,order_id,gateway_payment_id,kind,amount_paise,refunded_paise,method,reference,paid_at)
   VALUES($1,$2,$3,$4,$5,$6::text,'online',$7,$8,$9,$6::text,TO_TIMESTAMP($10))`,[paymentUuid,receipt,i.id,i.college_id,order.id,p.id,p.amount,refunded,String(p.method||'online').slice(0,30),Number.isSafeInteger(p.created_at)?p.created_at:Math.floor(Date.now()/1000)]);
   await audit(db,null,'payment.online_verified',i.id,{paymentId,amountPaise:p.amount,refundedPaise:refunded});
  }
  await db.query("UPDATE fee_orders SET state='paid' WHERE id=$1",[order.id]);return {settled:true,message:'Test payment verified.',receipt};
 });
}
// Mounted before express.json so signatures cover the original bytes.
async function webhook(req,res){
 try{
  const secret=process.env.RAZORPAY_WEBHOOK_SECRET;
  if(!secret)return res.status(503).json({message:'Test webhook is not configured.'});
  if(!Buffer.isBuffer(req.body)||!gateway.validSignature(req.get('X-Razorpay-Signature'),req.body,secret))return res.status(400).json({message:'Invalid webhook signature.'});
  let event;try{event=JSON.parse(req.body.toString('utf8'));}catch{return res.status(400).json({message:'Invalid event.'});}
  if(!['payment.captured','order.paid','refund.processed'].includes(event.event))return res.json({received:true,ignored:true});
  const paymentId=event.payload?.payment?.entity?.id||event.payload?.refund?.entity?.payment_id;
  if(typeof paymentId!=='string')return res.json({received:true,ignored:true});
  let orderId=event.payload?.payment?.entity?.order_id;
  let row;
  if(orderId)row=(await pool.query('SELECT id FROM fee_orders WHERE gateway_order_id=$1',[orderId])).rows[0];
  else row=(await pool.query('SELECT order_id AS id FROM fee_payments WHERE gateway_payment_id=$1',[paymentId])).rows[0];
  if(!row)return res.json({received:true,ignored:true});
  await applyPayment(row.id,paymentId);res.json({received:true});
 }catch(e){console.error('Payment webhook processing failed:',e.status||500);res.status(e.status&&e.status<500?e.status:503).json({message:'Webhook could not be processed. Retry later.'});}
}
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});router.use(requireAuth);
router.use(async(req,res,next)=>{try{const p=await pool.query("SELECT permission_code FROM user_permissions WHERE user_id=$1 AND permission_code IN ('fees.manage','payments.view','payments.record_offline')",[req.user.id]);req.feePermissions=p.rows.map(x=>x.permission_code);next();}catch(e){next(e);}});
router.get('/config',wrap(async(req,res)=>{const c=(await pool.query('SELECT code FROM colleges WHERE id=$1',[req.user.college_id])).rows[0];res.json({mode:'test',onlineReady:gateway.ready(c.code),permissions:req.feePermissions});}));
router.get('/invoices',wrap(async(req,res)=>{
 if(req.user.role!=='student')await staffRead(req);
 const search=typeof req.query.search==='string'?req.query.search.trim().slice(0,100):'';
 const r=await pool.query(`SELECT i.*,i.due_date::text AS due_date,u.full_name,u.login_id,
 COALESCE(p.paid,0)::integer AS paid_paise,CASE WHEN i.status='void' THEN 0 ELSE GREATEST(0,i.amount_paise-COALESCE(p.paid,0))::integer END AS balance_paise,
 GREATEST(0,COALESCE(p.paid,0)-i.amount_paise)::integer AS credit_paise,
 EXISTS(SELECT 1 FROM fee_orders o WHERE o.invoice_id=i.id AND o.state='open') AS has_open_order
 FROM fee_invoices i JOIN users u ON u.id=i.student_id
 LEFT JOIN (SELECT invoice_id,SUM(amount_paise-refunded_paise) AS paid FROM fee_payments GROUP BY invoice_id) p ON p.invoice_id=i.id
 WHERE i.college_id=$1 AND ($2::integer IS NULL OR i.student_id=$2)
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
  for(const studentId of ids){const r=await db.query('INSERT INTO fee_invoices(college_id,student_id,title,academic_year,due_date,amount_paise,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[req.user.college_id,studentId,title,year,due,amount,req.user.id]);await audit(db,req.user,'fee.assigned',r.rows[0].id,{amountPaise:amount,studentId,mode:'test'});}
 });res.status(201).json({message:`Assigned test fee to ${ids.length} student(s).`});
}));
router.patch('/invoices/:id',wrap(async(req,res)=>{
 const b=req.body||{};const version=id(b.version);
 await tx(async db=>{await permission(db,req.user,'fees.manage',true);const i=await invoice(db,req.params.id,req.user.college_id,true);
  if(i.status!=='active'||i.version!==version)throw fail(409,'Fee changed. Refresh before editing.');
  const used=await db.query('SELECT id FROM fee_orders WHERE invoice_id=$1 UNION ALL SELECT id FROM fee_payments WHERE invoice_id=$1',[i.id]);if(used.rowCount)throw fail(409,'This fee has a payment or checkout order and cannot be edited or voided.');
  if(b.action==='void'){await db.query("UPDATE fee_invoices SET status='void',version=version+1 WHERE id=$1",[i.id]);await audit(db,req.user,'fee.voided',i.id,{reason:str(b.reason,300,'Reason')});}
  else if(b.action==='edit'){const amount=money(b.amount),due=date(b.dueDate);await db.query('UPDATE fee_invoices SET amount_paise=$1,due_date=$2,version=version+1 WHERE id=$3',[amount,due,i.id]);await audit(db,req.user,'fee.edited',i.id,{previousAmountPaise:i.amount_paise,amountPaise:amount,dueDate:due});}
  else throw fail(400,'Choose edit or void.');
 });res.json({message:'Test fee updated.'});
}));
router.get('/invoices/:id/payments',wrap(async(req,res)=>{
 const i=await invoice(pool,req.params.id,req.user.college_id);
 if(req.user.role==='student')studentOwn(req,i);else if(req.user.role!=='admin')await permission(pool,req.user,'payments.view');
 const r=await pool.query('SELECT * FROM fee_payments WHERE invoice_id=$1 ORDER BY paid_at DESC',[i.id]);res.json({payments:r.rows});
}));
router.post('/invoices/:id/offline',wrap(async(req,res)=>{
 const b=req.body||{},amount=money(b.amount,1),reference=str(b.reference,100,'Offline reference'),key=uuid(b.idempotencyKey);
 if(!['cash','bank_transfer','cheque'].includes(b.method))throw fail(400,'Select an offline payment method.');
 const result=await tx(async db=>{await permission(db,req.user,'payments.record_offline',true);const i=await invoice(db,req.params.id,req.user.college_id,true);
  const old=(await db.query('SELECT * FROM fee_payments WHERE college_id=$1 AND idempotency_key=$2',[i.college_id,key])).rows[0];
  if(old){if(old.invoice_id!==i.id||old.amount_paise!==amount||old.reference!==reference||old.method!==b.method||old.recorded_by!==req.user.id)throw fail(409,'Request ID was already used for a different payment.');return old;}
  if(i.status!=='active')throw fail(409,'This fee is void.');
  const open=await db.query("SELECT id FROM fee_orders WHERE invoice_id=$1 AND state='open'",[i.id]);if(open.rowCount)throw fail(409,'Online checkout is open for this fee. Complete/check that checkout; offline entries are blocked to avoid duplicate payment.');
  const remaining=await balance(db,i);if(amount>remaining.due)throw fail(409,'Payment exceeds the outstanding balance. Refresh the fee.');
  const pid=crypto.randomUUID();const r=await db.query(`INSERT INTO fee_payments(id,receipt_number,invoice_id,college_id,kind,amount_paise,method,reference,idempotency_key,recorded_by)
  VALUES($1,$2,$3,$4,'offline',$5,$6,$7,$8,$9) RETURNING *`,[pid,'CC-TEST-'+pid,i.id,i.college_id,amount,b.method,reference,key,req.user.id]);await audit(db,req.user,'payment.offline_recorded',i.id,{paymentId:pid,amountPaise:amount,reference,mode:'test'});return r.rows[0];
 });res.json({message:'Offline test payment recorded. No money was transferred.',payment:result});
}));
router.post('/payments/:id/reverse',wrap(async(req,res)=>{
 const reason=str(req.body?.reason,300,'Reversal reason');
 await tx(async db=>{await permission(db,req.user,'payments.record_offline',true);const found=(await db.query("SELECT invoice_id FROM fee_payments WHERE id=$1 AND college_id=$2 AND kind='offline'",[uuid(req.params.id),req.user.college_id])).rows[0];if(!found)throw fail(404,'Offline payment not found.');
  const i=await invoice(db,found.invoice_id,req.user.college_id,true);const p=(await db.query('SELECT * FROM fee_payments WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
  if(p.refunded_paise!==p.amount_paise){await db.query('UPDATE fee_payments SET refunded_paise=amount_paise,updated_at=NOW() WHERE id=$1',[p.id]);await audit(db,req.user,'payment.offline_reversed',i.id,{paymentId:p.id,reason});}
 });res.json({message:'Offline test entry reversed. History was preserved.'});
}));
router.get('/payments/:id/receipt',wrap(async(req,res)=>{
 const p=(await pool.query('SELECT * FROM fee_payments WHERE id=$1 AND college_id=$2',[uuid(req.params.id),req.user.college_id])).rows[0];if(!p)throw fail(404,'Receipt not found.');const i=await invoice(pool,p.invoice_id,req.user.college_id);
 if(req.user.role==='student')studentOwn(req,i);else if(req.user.role!=='admin')await permission(pool,req.user,'payments.view');
 res.json({mode:'test',payment:p,invoice:{id:i.id,title:i.title,academicYear:i.academic_year,studentName:i.full_name,rollNumber:i.login_id,collegeName:i.college_name}});
}));
const onlineLimit=rateLimit({windowMs:10*60*1000,limit:30,standardHeaders:true,legacyHeaders:false,keyGenerator:req=>String(req.user.id),message:{message:'Too many gateway checks. Please wait a few minutes.'}});
router.post('/invoices/:id/order',onlineLimit,wrap(async(req,res)=>{
 const data=await tx(async db=>{const i=await invoice(db,req.params.id,req.user.college_id,true);studentOwn(req,i);if(i.status!=='active')throw fail(409,'This fee is void.');const cfg=gateway.config(i.college_code);
  const current=await balance(db,i);if(!current.due)throw fail(409,'This fee has no outstanding balance.');if(current.due<100)throw fail(409,'Online test checkout requires at least ₹1. Ask authorised staff to record the remaining amount as an offline test entry.');
  let order=(await db.query("SELECT * FROM fee_orders WHERE invoice_id=$1 AND state='open'",[i.id])).rows[0];
  if(!order){const oid=crypto.randomUUID();const created=await gateway.request(i.college_code,'/orders',{amount:current.due,currency:'INR',receipt:oid,partial_payment:false});
   providerId(created.id,'order');if(created.amount!==current.due||created.currency!=='INR')throw fail(502,'Gateway order did not match the fee.');
   order=(await db.query('INSERT INTO fee_orders(id,invoice_id,college_id,gateway_order_id,key_id,amount_paise) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[oid,i.id,i.college_id,created.id,cfg.keyId,current.due])).rows[0];await audit(db,req.user,'payment.order_created',i.id,{orderId:oid,amountPaise:current.due});
  }
  if(order.key_id!==cfg.keyId)throw fail(503,'Restore the original test key to use this existing order.');
  return {localOrderId:order.id,orderId:order.gateway_order_id,keyId:cfg.keyId,amount:order.amount_paise,currency:'INR',title:i.title,collegeName:i.college_name,mode:'test'};
 });res.json(data);
}));
router.post('/verify',onlineLimit,wrap(async(req,res)=>{
 const b=req.body||{},order=(await pool.query('SELECT * FROM fee_orders WHERE id=$1 AND college_id=$2',[uuid(b.localOrderId),req.user.college_id])).rows[0];if(!order)throw fail(404,'Order not found.');const i=await invoice(pool,order.invoice_id,req.user.college_id);studentOwn(req,i);
 const paymentId=providerId(b.razorpay_payment_id,'pay'),cfg=gateway.config(i.college_code);
 if(b.razorpay_order_id!==order.gateway_order_id||!gateway.validSignature(b.razorpay_signature,order.gateway_order_id+'|'+paymentId,cfg.secret))throw fail(400,'Payment signature verification failed.');
 res.json(await applyPayment(order.id,paymentId));
}));
router.post('/invoices/:id/sync',onlineLimit,wrap(async(req,res)=>{
 const i=await invoice(pool,req.params.id,req.user.college_id);if(req.user.role==='student')studentOwn(req,i);else if(req.user.role!=='admin')await permission(pool,req.user,'payments.view');
 const orders=await pool.query('SELECT * FROM fee_orders WHERE invoice_id=$1 ORDER BY created_at',[i.id]);let verified=0;
 for(const order of orders.rows){if(order.key_id!==gateway.config(i.college_code).keyId)throw fail(503,'Restore the original test key to check this order.');
  const known=(await pool.query('SELECT gateway_payment_id FROM fee_payments WHERE order_id=$1',[order.id])).rows[0];
  if(known){if((await applyPayment(order.id,known.gateway_payment_id)).settled)verified++;}
  else{const list=await gateway.request(i.college_code,'/orders/'+providerId(order.gateway_order_id,'order')+'/payments');if(!Array.isArray(list.items))throw fail(502,'Invalid payment status response.');for(const p of list.items){if(['captured','refunded'].includes(p.status)&& (await applyPayment(order.id,p.id)).settled)verified++;}}
 }
 res.json({message:orders.rowCount?`Checked online test payments. ${verified} captured payment(s) confirmed. Refresh the balance.`:'No online checkout has been started for this fee.'});
}));
router.use((e,req,res,next)=>{if(e.status)return res.status(e.status).json({message:e.message});if(e.code==='23505')return res.status(409).json({message:'This fee, payment reference or request already exists. No duplicate entry was added. Refresh and check the records.'});next(e);});
module.exports={router,webhook};
