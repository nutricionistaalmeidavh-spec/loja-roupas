import type {FastifyInstance} from 'fastify';
import type {Pool} from 'pg';
import {requirePermission} from './auth.ts';
import {DomainError,requireIdempotencyKey,withIdempotentTransaction} from './transactions.ts';
import {validateOperatingExpense,calculateOperatingResult} from './physical-finance.ts';

const uuid='^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$';
const datePattern='^\\d{4}-\\d{2}-\\d{2}$';
function validMonth(value:string):string{
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))throw new DomainError(422,'BAD_MONTH','Informe o mês no formato AAAA-MM.');
 return value+'-01';
}
function validBirth(value:string|null|undefined){
 if(!value)return null;
 const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
 const d=m?new Date(value+'T00:00:00Z'):null;
 if(!m||!d||d.toISOString().slice(0,10)!==value||Number(m[1])<1900||d.getTime()>Date.now())
  throw new DomainError(422,'BAD_BIRTH','Data de aniversário inválida.');
 return value;
}
function validCustomer(body:{name:string;phone?:string|null;email?:string|null;marketing_consent?:boolean;loyalty_opt_in?:boolean;birth_date?:string|null}){
 const name=String(body.name||'').trim(),phone=body.phone?String(body.phone).replace(/[\s()\-]/g,''):null;
 const email=body.email?String(body.email).trim().toLowerCase():null;
 if(name.length<2||name.length>120||phone&&!/^\+?[0-9]{10,15}$/.test(phone)||
    email&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254))
   throw new DomainError(422,'BAD_CUSTOMER','Informe nome, telefone e e-mail válidos.');
 return {name,phone,email,marketing_consent:body.marketing_consent===true,loyalty_opt_in:body.loyalty_opt_in===true,birth_date:validBirth(body.birth_date)};
}
export function registerPhysicalManagement(app:FastifyInstance,db:Pool){
 app.get('/v1/management/backup/authorization',async(request,reply)=>{
  if(requirePermission(request,reply,'system.backup'))return reply;
  return {allowed:true};
 });
 app.get<{Querystring:{month:string}}>('/v1/management/operational-result',{
  schema:{querystring:{type:'object',additionalProperties:false,required:['month'],properties:{month:{type:'string',maxLength:7}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'finance.read'))return reply;
  const start=validMonth(request.query.month),store=request.authContext!.storeId;
  const result=await db.query<{gross_cents:string;refunds_cents:string;expenses_cents:string}>(`
   SELECT
    (SELECT coalesce(sum(r.gross_cents),0)::text FROM retail_revenue_events r
     WHERE r.store_id=$1 AND r.occurred_at>=($2::date::timestamp AT TIME ZONE st.timezone)
     AND r.occurred_at< (($2::date+interval '1 month') AT TIME ZONE st.timezone)) AS gross_cents,
    (SELECT coalesce(sum(r.refund_cents),0)::text FROM retail_revenue_events r
     WHERE r.store_id=$1 AND r.occurred_at>=($2::date::timestamp AT TIME ZONE st.timezone)
     AND r.occurred_at< (($2::date+interval '1 month') AT TIME ZONE st.timezone)) AS refunds_cents,
    (SELECT coalesce(sum(e.amount_cents),0)::text FROM operating_expenses e
     WHERE e.store_id=$1 AND e.voided_at IS NULL
     AND e.occurred_on >= $2::date AND e.occurred_on < ($2::date+interval '1 month')) AS expenses_cents
   FROM stores st WHERE st.id=$1`,[store,start]);
  if(!result.rows.length)throw new DomainError(404,'STORE_NOT_FOUND','Loja não encontrada');
  return {month:request.query.month,...calculateOperatingResult({
   gross_cents:Number(result.rows[0].gross_cents),refunds_cents:Number(result.rows[0].refunds_cents),
   expenses_cents:Number(result.rows[0].expenses_cents)
  }),note:'Mesma base da DRE gerencial: vendas menos devoluções, trocas e estornos. Não inclui custo das peças.'};
 });
 app.get<{Querystring:{month?:string;limit?:number;offset?:number;include_voided?:boolean}}>('/v1/management/expenses',{
  schema:{querystring:{type:'object',additionalProperties:false,properties:{month:{type:'string',maxLength:7},
   limit:{type:'integer',minimum:1,maximum:500},offset:{type:'integer',minimum:0},include_voided:{type:'boolean'}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'finance.read'))return reply;
  const month=request.query.month?validMonth(request.query.month):null;
  const q=await db.query(`SELECT e.id::text,e.category,e.description,e.amount_cents::text,e.occurred_on::text,e.created_at,
    e.voided_at,e.void_reason,EXISTS(SELECT 1 FROM retail_accounts a WHERE a.store_id=e.store_id AND a.expense_record_id=e.id) AS from_payable,
    count(*) OVER()::int AS total_count
   FROM operating_expenses e WHERE e.store_id=$1 AND ($2::date IS NULL OR (e.occurred_on>=$2::date AND e.occurred_on<$2::date+interval '1 month'))
    AND ($5::boolean OR e.voided_at IS NULL)
   ORDER BY e.occurred_on DESC,e.created_at DESC,e.id DESC LIMIT $3 OFFSET $4`,
   [request.authContext!.storeId,month,request.query.limit??100,request.query.offset??0,request.query.include_voided===true]);
  return {items:q.rows,total:q.rows[0]?.total_count??0};
 });
 app.put<{Params:{id:string};Body:{amount_cents:number;category:string;description:string;occurred_on:string}}>('/v1/management/expenses/:id',{
  schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',pattern:uuid}}},
   body:{type:'object',additionalProperties:false,required:['amount_cents','category','description','occurred_on'],
    properties:{amount_cents:{type:'integer',minimum:1,maximum:9999999999},category:{type:'string',maxLength:80},
     description:{type:'string',maxLength:240},occurred_on:{type:'string',pattern:datePattern}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'finance.write'))return reply;
  const auth=request.authContext!,id=request.params.id,body=validateOperatingExpense(request.body);
  const out=await withIdempotentTransaction(db,auth,'physical.expense.update:'+id,requireIdempotencyKey(request.headers['idempotency-key']),body,async client=>{
   const linked=await client.query('SELECT 1 FROM retail_accounts WHERE store_id=$1 AND expense_record_id=$2',[auth.storeId,id]);
   if(linked.rowCount)throw new DomainError(409,'EXPENSE_FROM_PAYABLE','Esta despesa veio de uma conta a pagar; corrija pela conta');
   const before=await client.query(`SELECT amount_cents::text,category,description,occurred_on::text FROM operating_expenses
    WHERE store_id=$1 AND id=$2 AND voided_at IS NULL FOR UPDATE`,[auth.storeId,id]);
   if(!before.rowCount)throw new DomainError(404,'EXPENSE_NOT_FOUND','Despesa não encontrada ou estornada');
   await client.query(`UPDATE operating_expenses SET amount_cents=$3,category=$4,description=$5,occurred_on=$6,updated_at=now()
    WHERE store_id=$1 AND id=$2`,[auth.storeId,id,body.amount_cents,body.category,body.description,body.occurred_on]);
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail) VALUES($1,$2,'physical.expense.update',$3,$4::jsonb)`,
    [auth.storeId,auth.userId,id,JSON.stringify({before:before.rows[0],after:body})]);
   return {id,...body};
  });
  return out.result;
 });
 app.post<{Params:{id:string};Body:{reason:string}}>('/v1/management/expenses/:id/void',{
  schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',pattern:uuid}}},
   body:{type:'object',additionalProperties:false,required:['reason'],properties:{reason:{type:'string',minLength:8,maxLength:240}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'finance.write'))return reply;
  const auth=request.authContext!,id=request.params.id,reason=request.body.reason.trim();
  if(reason.length<8)throw new DomainError(422,'VOID_REASON','Explique o estorno com pelo menos 8 caracteres');
  const out=await withIdempotentTransaction(db,auth,'physical.expense.void:'+id,requireIdempotencyKey(request.headers['idempotency-key']),{reason},async client=>{
   const linked=await client.query('SELECT 1 FROM retail_accounts WHERE store_id=$1 AND expense_record_id=$2',[auth.storeId,id]);
   if(linked.rowCount)throw new DomainError(409,'EXPENSE_FROM_PAYABLE','Esta despesa veio de uma conta a pagar; cancele pela conta');
   const q=await client.query(`UPDATE operating_expenses SET voided_at=now(),voided_by=$3,void_reason=$4
    WHERE store_id=$1 AND id=$2 AND voided_at IS NULL RETURNING id`,[auth.storeId,id,auth.userId,reason]);
   if(!q.rowCount)throw new DomainError(404,'EXPENSE_NOT_FOUND','Despesa não encontrada ou já estornada');
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail) VALUES($1,$2,'physical.expense.void',$3,$4::jsonb)`,
    [auth.storeId,auth.userId,id,JSON.stringify({reason})]);
   return {id,voided:true};
  });
  return out.result;
 });
 app.post<{Body:{amount_cents:number;category:string;description:string;occurred_on:string}}>('/v1/management/expenses',{
  schema:{body:{type:'object',additionalProperties:false,required:['amount_cents','category','description','occurred_on'],
   properties:{amount_cents:{type:'integer',minimum:1,maximum:9999999999},category:{type:'string',maxLength:80},
    description:{type:'string',maxLength:240},occurred_on:{type:'string',pattern:datePattern}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'finance.write'))return reply;
  const auth=request.authContext!,body=validateOperatingExpense(request.body);
  const op=await withIdempotentTransaction(db,auth,'physical.expense',requireIdempotencyKey(request.headers['idempotency-key']),body,async client=>{
   const q=await client.query<{id:string}>(`INSERT INTO operating_expenses(store_id,created_by,amount_cents,category,description,occurred_on)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text`,[auth.storeId,auth.userId,body.amount_cents,body.category,body.description,body.occurred_on]);
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id) VALUES($1,$2,'physical.expense.create',$3)`,[auth.storeId,auth.userId,q.rows[0].id]);
   return {id:q.rows[0].id,...body};
  });
  return reply.code(op.replayed?200:201).send({...op.result,replayed:op.replayed});
 });
 app.post<{Params:{id:string};Body:{marketing_consent:boolean;loyalty_opt_in:boolean}}>('/v1/management/customers/:id/consents',{
  schema:{params:{type:'object',additionalProperties:false,required:['id'],properties:{id:{type:'string',pattern:uuid}}},
   body:{type:'object',additionalProperties:false,required:['marketing_consent','loyalty_opt_in'],
    properties:{marketing_consent:{type:'boolean'},loyalty_opt_in:{type:'boolean'}}}}
 },async(req,reply)=>{
  if(requirePermission(req,reply,'customer.write'))return reply;
  const auth=req.authContext!,body=req.body;
  const out=await withIdempotentTransaction(db,auth,'retail.customer.consents:'+req.params.id,
   requireIdempotencyKey(req.headers['idempotency-key']),body,async client=>{
   const customer=await client.query<{id:string}>(`SELECT id::text FROM retail_customers
    WHERE store_id=$1 AND id=$2 AND anonymized_at IS NULL FOR UPDATE`,[auth.storeId,req.params.id]);
   if(!customer.rowCount)throw new DomainError(404,'CUSTOMER_NOT_FOUND','Cliente não encontrado');
   await client.query(`UPDATE retail_customers SET marketing_consent=$3,loyalty_opt_in=$4
    WHERE store_id=$1 AND id=$2`,[auth.storeId,req.params.id,body.marketing_consent,body.loyalty_opt_in]);
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
    VALUES($1,$2,'customer.consents.update',$3,$4::jsonb)`,
    [auth.storeId,auth.userId,req.params.id,JSON.stringify(body)]);
   return {id:req.params.id,...body};
  });
  return out.result;
 });
 app.get<{Querystring:{q?:string;limit?:number;offset?:number}}>('/v1/management/customers',{
  schema:{querystring:{type:'object',additionalProperties:false,properties:{q:{type:'string',maxLength:120},
   limit:{type:'integer',minimum:1,maximum:500},offset:{type:'integer',minimum:0}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'customer.read'))return reply;
  const term=(request.query.q??'').trim().toLowerCase();
  const digits=term.replace(/\D/g,'');
  const q=await db.query(`SELECT id::text,name,phone,email,marketing_consent,loyalty_opt_in,to_char(birth_date,'YYYY-MM-DD') AS birth_date,created_at,count(*) OVER()::int AS total_count
   FROM retail_customers
   WHERE store_id=$1 AND anonymized_at IS NULL
    AND ($2='' OR lower(name) LIKE '%'||$2||'%' OR ($3<>'' AND phone LIKE '%'||$3||'%') OR lower(coalesce(email,'')) LIKE '%'||$2||'%')
   ORDER BY lower(name),id LIMIT $4 OFFSET $5`,
   [request.authContext!.storeId,term.replace(/[%_\\]/g,''),digits,request.query.limit??100,request.query.offset??0]);
  return {items:q.rows,total:q.rows[0]?.total_count??0};
 });
 app.post<{Body:{name:string;phone?:string|null;email?:string|null;marketing_consent?:boolean;loyalty_opt_in?:boolean;birth_date?:string|null}}>('/v1/management/customers',{
  schema:{body:{type:'object',additionalProperties:false,required:['name'],properties:{
   name:{type:'string',minLength:2,maxLength:120},phone:{type:['string','null'],maxLength:24},
   email:{type:['string','null'],maxLength:254},marketing_consent:{type:'boolean'},loyalty_opt_in:{type:'boolean'},
   birth_date:{type:['string','null'],maxLength:10}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'customer.write'))return reply;
  const auth=request.authContext!,body=validCustomer(request.body);
  const op=await withIdempotentTransaction(db,auth,'physical.customer',requireIdempotencyKey(request.headers['idempotency-key']),body,async client=>{
   const q=await client.query<{id:string}>(`INSERT INTO retail_customers(store_id,created_by,name,phone,email,marketing_consent,loyalty_opt_in,birth_date)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id::text`,[auth.storeId,auth.userId,body.name,body.phone,body.email,body.marketing_consent,body.loyalty_opt_in,body.birth_date]);
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id) VALUES($1,$2,'physical.customer.create',$3)`,[auth.storeId,auth.userId,q.rows[0].id]);
   return {id:q.rows[0].id,...body};
  });
  return reply.code(op.replayed?200:201).send({...op.result,replayed:op.replayed});
 });
 app.post<{Params:{id:string}}>('/v1/management/customers/:id/anonymize',{
  schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',pattern:uuid}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'customer.write'))return reply;
  const auth=request.authContext!,id=request.params.id;
  const op=await withIdempotentTransaction(db,auth,'physical.customer.anonymize:'+id,
   requireIdempotencyKey(request.headers['idempotency-key']),{},async client=>{
   const debt=await client.query<{open:string}>(`SELECT coalesce(sum(amount_cents-settled_cents),0)::text AS open
    FROM retail_accounts WHERE store_id=$1 AND customer_id=$2 AND kind='receivable' AND cancelled_at IS NULL`,[auth.storeId,id]);
   if(Number(debt.rows[0].open)>0)
    throw new DomainError(409,'CUSTOMER_HAS_DEBT','Cliente com crediário em aberto não pode ser anonimizado. Quite ou cancele as parcelas antes.');
   const q=await client.query(`UPDATE retail_customers SET name='Cliente anonimizado',phone=NULL,email=NULL,
    marketing_consent=false,anonymized_at=now() WHERE store_id=$1 AND id=$2 AND anonymized_at IS NULL RETURNING id`,
    [auth.storeId,id]);
   if(!q.rowCount)throw new DomainError(404,'CUSTOMER_NOT_FOUND','Cliente não encontrado.');
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id) VALUES($1,$2,'physical.customer.anonymize',$3)`,[auth.storeId,auth.userId,id]);
   return {id,anonymized:true};
  });
  return op.result;
 });
}
