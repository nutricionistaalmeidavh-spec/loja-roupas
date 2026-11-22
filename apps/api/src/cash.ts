import type { FastifyInstance } from 'fastify';
import type { Pool,PoolClient } from 'pg';
import { requirePermission } from './auth.ts';
import type { AuthContext } from './auth.ts';
import { DomainError,requireIdempotencyKey,withIdempotentTransaction } from './transactions.ts';

const uid='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
type CashRow={id:string;store_id:string;terminal_code:string;opened_by:string;opening_cents:string;
 opened_at:Date;closed_at:Date|null};
export async function expectedCash(db:Pick<PoolClient,'query'>,storeId:string,id:string,opening:number){
 const p=await db.query<{cash_in:string;change_total:string}>(`SELECT
 (SELECT COALESCE(SUM(sp.amount_cents),0)::text FROM sale_payments sp
  JOIN sales s ON s.id=sp.sale_id AND s.store_id=sp.store_id
  WHERE s.store_id=$1 AND s.cash_session_id=$2 AND sp.method='cash') AS cash_in,
 (SELECT COALESCE(SUM(s.change_cents),0)::text FROM sales s
  WHERE s.store_id=$1 AND s.cash_session_id=$2) AS change_total`,[storeId,id]);
 const m=await db.query<{movement_total:string}>(`SELECT COALESCE(SUM(CASE WHEN kind IN ('supply','credit_collection','exchange_collection') THEN amount_cents ELSE -amount_cents END),0)::text AS movement_total
 FROM cash_movements WHERE store_id=$1 AND cash_session_id=$2`,[storeId,id]);
 const result=opening+Number(p.rows[0].cash_in)-Number(p.rows[0].change_total)+Number(m.rows[0].movement_total);
 if(!Number.isSafeInteger(result)||result<0)throw new DomainError(409,'CASH_INVALID','Valor esperado do caixa inválido');
 return result;
}
function canUseCash(auth:AuthContext,openUser:string){
 if(!auth.roles.includes('manager')&&auth.userId!==openUser)
  throw new DomainError(403,'CASH_OWNER','Este caixa pertence a outro operador');
}
export function registerCash(app:FastifyInstance,db:Pool){
 app.post<{Body:{terminal_code:string;opening_cents:number}}>('/v1/cash-sessions',{
  schema:{body:{type:'object',additionalProperties:false,required:['terminal_code','opening_cents'],properties:{
   terminal_code:{type:'string',pattern:'^[A-Za-z0-9-]{3,32}$'},opening_cents:{type:'integer',minimum:0}
  }}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'cash.manage'))return reply;
  const auth=request.authContext!,body={terminal_code:request.body.terminal_code.trim().toUpperCase(),opening_cents:request.body.opening_cents};
  const key=requireIdempotencyKey(request.headers['idempotency-key']);
  const out=await withIdempotentTransaction(db,auth,'cash.open:'+body.terminal_code,key,body,async client=>{
   const row=await client.query<{id:string;opened_at:Date}>(`INSERT INTO cash_sessions
    (store_id,terminal_code,opened_by,opening_cents)
    VALUES($1,$2,$3,$4) RETURNING id::text,opened_at`,[auth.storeId,body.terminal_code,auth.userId,body.opening_cents]);
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
    VALUES($1,$2,'cash.open',$3,$4::jsonb)`,[auth.storeId,auth.userId,row.rows[0].id,JSON.stringify(body)]);
   return {id:row.rows[0].id,terminal_code:body.terminal_code,opening_cents:body.opening_cents,opened_at:row.rows[0].opened_at,active:true};
  });
  return reply.code(201).send(out.result);
 });
 app.get<{Querystring:{terminal?:string}}>('/v1/cash-sessions/current',{
  schema:{querystring:{type:'object',additionalProperties:false,properties:{terminal:{type:'string',maxLength:32}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'cash.manage'))return reply;
  const terminal=(request.query.terminal??'CAIXA-01').trim().toUpperCase();
  const row=await db.query<CashRow>(`SELECT * FROM cash_sessions WHERE store_id=$1 AND terminal_code=$2
   AND closed_at IS NULL LIMIT 1`,[request.authContext!.storeId,terminal]);
  if(!row.rowCount)return {active:false,terminal_code:terminal};
  canUseCash(request.authContext!,row.rows[0].opened_by);
  return {id:row.rows[0].id,terminal_code:terminal,opening_cents:Number(row.rows[0].opening_cents),
   opened_at:row.rows[0].opened_at,active:true};
 });
 app.post<{Params:{id:string};Body:{kind:'supply'|'withdrawal';amount_cents:number;reason:string}}>(
 '/v1/cash-sessions/:id/movements',{
  schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',pattern:uid}}},body:{
   type:'object',additionalProperties:false,required:['kind','amount_cents','reason'],properties:{
    kind:{type:'string',enum:['supply','withdrawal']},amount_cents:{type:'integer',minimum:1},
    reason:{type:'string',minLength:8,maxLength:250}
   }}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'cash.manage'))return reply;
  const auth=request.authContext!,key=requireIdempotencyKey(request.headers['idempotency-key']),body=request.body;
  const out=await withIdempotentTransaction(db,auth,'cash.movement:'+request.params.id,key,body,async client=>{
   const cash=await client.query<CashRow>(`SELECT * FROM cash_sessions WHERE id=$1 AND store_id=$2 FOR UPDATE`,
    [request.params.id,auth.storeId]);
   if(!cash.rowCount||cash.rows[0].closed_at)throw new DomainError(409,'CASH_CLOSED','Caixa não está aberto');
   canUseCash(auth,cash.rows[0].opened_by);
   const current=await expectedCash(client,auth.storeId,request.params.id,Number(cash.rows[0].opening_cents));
   if(body.kind==='withdrawal'&&body.amount_cents>current)throw new DomainError(409,'INSUFFICIENT_CASH','Saldo insuficiente para sangria');
   const row=await client.query<{id:string}>(`INSERT INTO cash_movements
    (store_id,cash_session_id,actor_id,kind,amount_cents,reason)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text`,
    [auth.storeId,request.params.id,auth.userId,body.kind,body.amount_cents,body.reason.trim()]);
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
    VALUES($1,$2,'cash.movement',$3,$4::jsonb)`,[auth.storeId,auth.userId,request.params.id,
    JSON.stringify({movement_id:row.rows[0].id,...body})]);
   return {id:row.rows[0].id,expected_cash_cents:current+(body.kind==='supply'?body.amount_cents:-body.amount_cents)};
  });
  return reply.code(201).send(out.result);
 });
 app.post<{Params:{id:string};Body:{counted_cash_cents:number;reason?:string}}>('/v1/cash-sessions/:id/close',{
  schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',pattern:uid}}},body:{
   type:'object',additionalProperties:false,required:['counted_cash_cents'],properties:{
    counted_cash_cents:{type:'integer',minimum:0},reason:{type:'string',maxLength:250}
   }}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'cash.manage'))return reply;
  const auth=request.authContext!,key=requireIdempotencyKey(request.headers['idempotency-key']);
  const out=await withIdempotentTransaction(db,auth,'cash.close:'+request.params.id,key,request.body,async client=>{
   const found=await client.query<CashRow>(`SELECT * FROM cash_sessions WHERE id=$1 AND store_id=$2 FOR UPDATE`,
    [request.params.id,auth.storeId]);
   if(!found.rowCount||found.rows[0].closed_at)throw new DomainError(409,'CASH_CLOSED','Caixa não está aberto');
   canUseCash(auth,found.rows[0].opened_by);
   const expected=await expectedCash(client,auth.storeId,request.params.id,Number(found.rows[0].opening_cents));
   const difference=request.body.counted_cash_cents-expected;
   if(difference!==0&&(!request.body.reason||request.body.reason.trim().length<8))
    throw new DomainError(422,'CASH_DIFFERENCE_REASON','Justifique divergência de caixa com ao menos 8 caracteres');
   await client.query(`UPDATE cash_sessions SET closed_at=now(),closed_by=$3,
    expected_cash_cents=$4,counted_cash_cents=$5,difference_cents=$6 WHERE id=$1 AND store_id=$2`,
    [request.params.id,auth.storeId,auth.userId,expected,request.body.counted_cash_cents,difference]);
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
    VALUES($1,$2,'cash.close',$3,$4::jsonb)`,[auth.storeId,auth.userId,request.params.id,
    JSON.stringify({expected,counted:request.body.counted_cash_cents,difference,reason:request.body.reason})]);
   return {id:request.params.id,active:false,expected_cash_cents:expected,
    counted_cash_cents:request.body.counted_cash_cents,difference_cents:difference};
  });
  return out.result;
 });
}
