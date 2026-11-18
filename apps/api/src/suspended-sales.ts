import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { requirePermission } from './auth.ts';
import { DomainError,requireIdempotencyKey,withIdempotentTransaction } from './transactions.ts';
const uid='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
type Line={variant_id:string;quantity:number};
type Request={cash_session_id:string;lines:Line[];note?:string};
export function registerSuspendedSales(app:FastifyInstance,db:Pool){
 app.post<{Body:Request}>('/v1/sales/drafts',{schema:{body:{
  type:'object',additionalProperties:false,required:['cash_session_id','lines'],
  properties:{cash_session_id:{type:'string',pattern:uid},note:{type:'string',maxLength:250},
  lines:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,
   required:['variant_id','quantity'],properties:{variant_id:{type:'string',pattern:uid},quantity:{type:'integer',minimum:1,maximum:10000}}}}}
 }}},async(request,reply)=>{
  if(requirePermission(request,reply,'sale.commit'))return reply;
  const auth=request.authContext!,payload=request.body,key=requireIdempotencyKey(request.headers['idempotency-key']);
  if(new Set(payload.lines.map(l=>l.variant_id)).size!==payload.lines.length)
   throw new DomainError(422,'DUPLICATE_VARIANT','Junte quantidades da mesma peça');
  const normalized={...payload,note:payload.note?.trim()??''};
  const out=await withIdempotentTransaction(db,auth,'sales.draft.suspend',key,normalized,async client=>{
   const cash=await client.query<{opened_by:string;closed_at:Date|null}>(`SELECT opened_by::text,closed_at
    FROM cash_sessions WHERE id=$1 AND store_id=$2 FOR UPDATE`,[payload.cash_session_id,auth.storeId]);
   if(!cash.rowCount||cash.rows[0].closed_at)throw new DomainError(409,'CASH_CLOSED','Caixa fechado');
   if(!auth.roles.includes('manager')&&cash.rows[0].opened_by!==auth.userId)
    throw new DomainError(403,'CASH_OWNER','Caixa de outro operador');
   const created=await client.query<{id:string;created_at:Date}>(`INSERT INTO suspended_sale_drafts
    (store_id,cash_session_id,cashier_id,lines,note)
    VALUES($1,$2,$3,$4::jsonb,$5) RETURNING id::text,created_at`,
    [auth.storeId,payload.cash_session_id,auth.userId,JSON.stringify(payload.lines),normalized.note]);
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
    VALUES($1,$2,'sales.draft.suspend',$3,$4::jsonb)`,
    [auth.storeId,auth.userId,created.rows[0].id,JSON.stringify({lines:payload.lines.length})]);
   return {id:created.rows[0].id,status:'suspended',created_at:created.rows[0].created_at};
  });
  return reply.code(201).send(out.result);
 });
 app.get('/v1/sales/drafts',async(request,reply)=>{
  if(requirePermission(request,reply,'sale.read'))return reply;
  const rows=await db.query<{id:string;cash_session_id:string;note:string;lines:Line[];created_at:Date}>(`SELECT id::text,
   cash_session_id::text,note,lines,created_at FROM suspended_sale_drafts
   WHERE store_id=$1 AND status='suspended' AND ($2::boolean OR cashier_id=$3)
   ORDER BY created_at DESC,id DESC LIMIT 50`,
   [request.authContext!.storeId,request.authContext!.roles.includes('manager'),request.authContext!.userId]);
  return {items:rows.rows};
 });
 app.post<{Params:{id:string};Body:Record<string,never>}>('/v1/sales/drafts/:id/resume',{
  schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',pattern:uid}}},
   body:{type:'object',additionalProperties:false}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'sale.commit'))return reply;
  const auth=request.authContext!,key=requireIdempotencyKey(request.headers['idempotency-key']);
  const result=await withIdempotentTransaction(db,auth,'sales.draft.resume:'+request.params.id,key,{},async client=>{
   const draft=await client.query<{id:string;lines:Line[];status:string;cash_session_id:string;cashier_id:string}>(`SELECT id::text,lines,status,cash_session_id::text,cashier_id::text
    FROM suspended_sale_drafts WHERE id=$1 AND store_id=$2 FOR UPDATE`,[request.params.id,auth.storeId]);
   if(!draft.rowCount||draft.rows[0].status!=='suspended')
    throw new DomainError(409,'DRAFT_ALREADY_RESUMED','Venda suspensa não está disponível');
   if(!auth.roles.includes('manager')&&draft.rows[0].cashier_id!==auth.userId)
    throw new DomainError(403,'DRAFT_OWNER','Venda suspensa por outro operador');
   const resumed=[];for(const line of draft.rows[0].lines){
    const v=await client.query<{id:string;sku:string;color:string;size:string;price_cents:string;available:string}>(`SELECT v.id::text,
      v.sku,v.color,v.size,v.price_cents::text,(coalesce(s.on_hand,0)-coalesce(s.reserved,0))::text AS available
      FROM product_variants v LEFT JOIN stock_balances s ON s.variant_id=v.id AND s.store_id=v.store_id
      WHERE v.id=$1 AND v.store_id=$2`,[line.variant_id,auth.storeId]);
    if(!v.rowCount)throw new DomainError(409,'DRAFT_INVALID','Variante removida ou indisponível');
    resumed.push({quantity:line.quantity,variant:{id:v.rows[0].id,sku:v.rows[0].sku,
      color:v.rows[0].color,size:v.rows[0].size,priceCents:Number(v.rows[0].price_cents),
      available:Number(v.rows[0].available)}});
   }
   await client.query("UPDATE suspended_sale_drafts SET status='resumed',resumed_at=now() WHERE id=$1 AND store_id=$2",
    [request.params.id,auth.storeId]);
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
    VALUES($1,$2,'sales.draft.resume',$3,$4::jsonb)`,
    [auth.storeId,auth.userId,request.params.id,JSON.stringify({lines:resumed.length})]);
   return {id:request.params.id,cash_session_id:draft.rows[0].cash_session_id,lines:resumed};
  });
  return result.result;
 });
}
