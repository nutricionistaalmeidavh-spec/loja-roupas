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
function validCustomer(body:{name:string;phone?:string|null;email?:string|null;marketing_consent?:boolean}){
 const name=String(body.name||'').trim(),phone=body.phone?String(body.phone).replace(/[\s()\-]/g,''):null;
 const email=body.email?String(body.email).trim().toLowerCase():null;
 if(name.length<2||name.length>120||phone&&!/^\+?[0-9]{10,15}$/.test(phone)||
    email&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254))
   throw new DomainError(422,'BAD_CUSTOMER','Informe nome, telefone e e-mail válidos.');
 return {name,phone,email,marketing_consent:body.marketing_consent===true};
}
export function registerPhysicalManagement(app:FastifyInstance,db:Pool){
 app.get<{Querystring:{month:string}}>('/v1/management/operational-result',{
  schema:{querystring:{type:'object',additionalProperties:false,required:['month'],properties:{month:{type:'string',maxLength:7}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'finance.read'))return reply;
  const start=validMonth(request.query.month),store=request.authContext!.storeId;
  const result=await db.query<{gross_cents:string;refunds_cents:string;expenses_cents:string}>(`
   SELECT
    (SELECT coalesce(sum(s.total_cents),0)::text FROM sales s
     WHERE s.store_id=$1 AND s.created_at>=($2::date::timestamp AT TIME ZONE st.timezone)
     AND s.created_at< (($2::date+interval '1 month') AT TIME ZONE st.timezone)
     AND s.status<>'cancelled') AS gross_cents,
    (SELECT coalesce(sum(r.amount_cents),0)::text FROM cash_sale_returns r
     WHERE r.store_id=$1 AND r.created_at>=($2::date::timestamp AT TIME ZONE st.timezone)
     AND r.created_at< (($2::date+interval '1 month') AT TIME ZONE st.timezone)) AS refunds_cents,
    (SELECT coalesce(sum(e.amount_cents),0)::text FROM operating_expenses e
     WHERE e.store_id=$1 AND e.occurred_on >= $2::date AND e.occurred_on < ($2::date+interval '1 month')) AS expenses_cents
   FROM stores st WHERE st.id=$1`,[store,start]);
  if(!result.rows.length)throw new DomainError(404,'STORE_NOT_FOUND','Loja não encontrada');
  return {month:request.query.month,...calculateOperatingResult({
   gross_cents:Number(result.rows[0].gross_cents),refunds_cents:Number(result.rows[0].refunds_cents),
   expenses_cents:Number(result.rows[0].expenses_cents)
  }),note:'Resultado gerencial parcial, não equivale à DRE contábil ou emissão fiscal.'};
 });
 app.get('/v1/management/expenses',async(request,reply)=>{
  if(requirePermission(request,reply,'finance.read'))return reply;
  const q=await db.query(`SELECT id::text,category,description,amount_cents::text,occurred_on::text,created_at
   FROM operating_expenses WHERE store_id=$1 ORDER BY occurred_on DESC,created_at DESC,id DESC LIMIT 100`,
   [request.authContext!.storeId]);
  return {items:q.rows};
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
 app.get('/v1/management/customers',async(request,reply)=>{
  if(requirePermission(request,reply,'customer.read'))return reply;
  const q=await db.query(`SELECT id::text,name,phone,email,marketing_consent,created_at FROM retail_customers
   WHERE store_id=$1 AND anonymized_at IS NULL ORDER BY lower(name),id LIMIT 100`,[request.authContext!.storeId]);
  return {items:q.rows};
 });
 app.post<{Body:{name:string;phone?:string|null;email?:string|null;marketing_consent?:boolean}}>('/v1/management/customers',{
  schema:{body:{type:'object',additionalProperties:false,required:['name'],properties:{
   name:{type:'string',minLength:2,maxLength:120},phone:{type:['string','null'],maxLength:24},
   email:{type:['string','null'],maxLength:254},marketing_consent:{type:'boolean'}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'customer.write'))return reply;
  const auth=request.authContext!,body=validCustomer(request.body);
  const op=await withIdempotentTransaction(db,auth,'physical.customer',requireIdempotencyKey(request.headers['idempotency-key']),body,async client=>{
   const q=await client.query<{id:string}>(`INSERT INTO retail_customers(store_id,created_by,name,phone,email,marketing_consent)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text`,[auth.storeId,auth.userId,body.name,body.phone,body.email,body.marketing_consent]);
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
