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
 app.get<{Querystring:{limit?:number;before?:string}}>('/v1/cash-sessions',{
  schema:{querystring:{type:'object',additionalProperties:false,properties:{
   limit:{type:'integer',minimum:1,maximum:200},before:{type:'string',format:'date-time'}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'finance.read'))return reply;
  const q=await db.query(`SELECT c.id::text,c.terminal_code,c.opened_at,c.closed_at,c.opening_cents::text,
    c.expected_cash_cents::text,c.counted_cash_cents::text,c.difference_cents::text,
    coalesce(o.display_name,o.login) AS opened_by,coalesce(x.display_name,x.login) AS closed_by,
    (SELECT count(*) FROM sales s WHERE s.store_id=c.store_id AND s.cash_session_id=c.id)::int AS sale_count,
    (SELECT coalesce(sum(total_cents),0)::text FROM sales s WHERE s.store_id=c.store_id AND s.cash_session_id=c.id) AS sales_cents,
    (SELECT a.detail->>'reason' FROM audit_logs a WHERE a.store_id=c.store_id AND a.aggregate_id=c.id
      AND a.action='cash.close' ORDER BY a.occurred_at DESC LIMIT 1) AS close_reason
   FROM cash_sessions c JOIN users o ON o.id=c.opened_by LEFT JOIN users x ON x.id=c.closed_by
   WHERE c.store_id=$1 AND ($2::timestamptz IS NULL OR c.opened_at<$2)
   ORDER BY c.opened_at DESC,c.id DESC LIMIT $3`,
   [request.authContext!.storeId,request.query.before??null,request.query.limit??50]);
  return {items:q.rows};
 });
 app.get<{Params:{id:string}}>('/v1/cash-sessions/:id/summary',{
  schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',pattern:uid}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'cash.manage'))return reply;
  const auth=request.authContext!,id=request.params.id;
  const cash=await db.query<CashRow&{expected_cash_cents:string|null;counted_cash_cents:string|null;difference_cents:string|null}>(
   'SELECT * FROM cash_sessions WHERE id=$1 AND store_id=$2',[id,auth.storeId]);
  if(!cash.rowCount)throw new DomainError(404,'CASH_NOT_FOUND','Caixa não encontrado');
  const row=cash.rows[0];
  if(!auth.roles.includes('manager')&&!auth.roles.includes('technician'))canUseCash(auth,row.opened_by);
  const payments=await db.query<{method:string;amount_cents:string;count:string}>(`SELECT sp.method,
    sum(sp.amount_cents)::text AS amount_cents,count(DISTINCT sp.sale_id)::text AS count
   FROM sale_payments sp JOIN sales s ON s.id=sp.sale_id AND s.store_id=sp.store_id
   WHERE s.store_id=$1 AND s.cash_session_id=$2 GROUP BY sp.method ORDER BY sp.method`,[auth.storeId,id]);
  const sales=await db.query<{count:string;total:string;discount:string;change:string}>(`SELECT count(*)::text AS count,
   coalesce(sum(total_cents),0)::text AS total,coalesce(sum(discount_cents),0)::text AS discount,
   coalesce(sum(change_cents),0)::text AS change FROM sales WHERE store_id=$1 AND cash_session_id=$2`,[auth.storeId,id]);
  const movements=await db.query<{kind:string;amount_cents:string;count:string}>(`SELECT kind,sum(amount_cents)::text AS amount_cents,
   count(*)::text AS count FROM cash_movements WHERE store_id=$1 AND cash_session_id=$2 GROUP BY kind ORDER BY kind`,[auth.storeId,id]);
  const refunds=await db.query<{method:string;amount_cents:string}>(`SELECT p.method,sum(p.amount_cents)::text AS amount_cents
   FROM retail_refund_parts p JOIN retail_after_sales a ON a.id=p.operation_id AND a.store_id=p.store_id
   WHERE a.store_id=$1 AND a.cash_session_id=$2 GROUP BY p.method
   UNION ALL SELECT 'cash',coalesce(sum(amount_cents),0)::text FROM cash_sale_returns WHERE store_id=$1 AND cash_session_id=$2
   HAVING count(*)>0`,[auth.storeId,id]);
  const expected=row.closed_at?Number(row.expected_cash_cents):await expectedCash(db,auth.storeId,id,Number(row.opening_cents));
  return {id,terminal_code:row.terminal_code,opened_at:row.opened_at,closed_at:row.closed_at,
   opening_cents:Number(row.opening_cents),expected_cash_cents:expected,
   counted_cash_cents:row.counted_cash_cents===null?null:Number(row.counted_cash_cents),
   difference_cents:row.difference_cents===null?null:Number(row.difference_cents),
   sales:{count:Number(sales.rows[0].count),total_cents:Number(sales.rows[0].total),
    discount_cents:Number(sales.rows[0].discount),change_cents:Number(sales.rows[0].change)},
   payments:payments.rows.map(p=>({method:p.method,amount_cents:Number(p.amount_cents),sales:Number(p.count)})),
   movements:movements.rows.map(m=>({kind:m.kind,amount_cents:Number(m.amount_cents),count:Number(m.count)})),
   refunds:refunds.rows.map(r=>({method:r.method,amount_cents:Number(r.amount_cents)}))};
 });
 app.post<{Body:{terminal_code:string;opening_cents:number}}>('/v1/cash-sessions',{
  schema:{body:{type:'object',additionalProperties:false,required:['terminal_code','opening_cents'],properties:{
   terminal_code:{type:'string',pattern:'^[A-Za-z0-9-]{3,32}$'},opening_cents:{type:'integer',minimum:0}
  }}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'cash.manage'))return reply;
  const auth=request.authContext!,body={terminal_code:request.body.terminal_code.trim().toUpperCase(),opening_cents:request.body.opening_cents};
  const key=requireIdempotencyKey(request.headers['idempotency-key']);
  const out=await withIdempotentTransaction(db,auth,'cash.open:'+body.terminal_code,key,body,async client=>{
   const open=await client.query<{opened_by:string}>(`SELECT opened_by::text FROM cash_sessions
    WHERE store_id=$1 AND terminal_code=$2 AND closed_at IS NULL LIMIT 1`,[auth.storeId,body.terminal_code]);
   if(open.rowCount)throw new DomainError(409,open.rows[0].opened_by===auth.userId?'CASH_ALREADY_OPEN':'CASH_OWNER',
    open.rows[0].opened_by===auth.userId?'Este caixa já está aberto':'Este caixa pertence a outro operador');
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
