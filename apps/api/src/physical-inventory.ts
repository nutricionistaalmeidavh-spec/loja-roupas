import type {FastifyInstance} from 'fastify';
import type {Pool} from 'pg';
import {requirePermission} from './auth.ts';
import {DomainError,requireIdempotencyKey,withIdempotentTransaction} from './transactions.ts';
import {reconcileCount} from './physical-inventory-rules.ts';
const uuid='^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$';
const idParams={type:'object',required:['id'],properties:{id:{type:'string',pattern:uuid}}};
export function registerPhysicalInventory(app:FastifyInstance,db:Pool){
 app.get('/v1/management/inventory-counts/current',async(request,reply)=>{
  if(requirePermission(request,reply,'stock.count'))return reply;
  const store=request.authContext!.storeId;
  const count=await db.query<{id:string;started_at:Date}>(`SELECT id::text,started_at FROM inventory_count_sessions
   WHERE store_id=$1 AND closed_at IS NULL LIMIT 1`,[store]);
  if(!count.rowCount)return {active:false,lines:[]};
  const lines=await db.query(`SELECT l.variant_id::text,p.name,v.sku,v.color,v.size,
    l.expected_on_hand::text,l.counted_on_hand::text,l.updated_at
   FROM inventory_count_lines l JOIN product_variants v ON v.store_id=l.store_id AND v.id=l.variant_id
   JOIN products p ON p.store_id=v.store_id AND p.id=v.product_id
   WHERE l.store_id=$1 AND l.count_id=$2 ORDER BY v.sku,v.id`,[store,count.rows[0].id]);
  return {active:true,id:count.rows[0].id,started_at:count.rows[0].started_at,lines:lines.rows};
 });
 app.post('/v1/management/inventory-counts',async(request,reply)=>{
  if(requirePermission(request,reply,'stock.count'))return reply;
  const auth=request.authContext!;
  const out=await withIdempotentTransaction(db,auth,'inventory.start',
   requireIdempotencyKey(request.headers['idempotency-key']),{},async client=>{
   const current=await client.query<{id:string}>(`SELECT id::text FROM inventory_count_sessions WHERE store_id=$1 AND closed_at IS NULL FOR UPDATE`,[auth.storeId]);
   if(current.rowCount)return {id:current.rows[0].id,active:true};
   const count=await client.query<{id:string}>(`INSERT INTO inventory_count_sessions(store_id,started_by) VALUES($1,$2) RETURNING id::text`,[auth.storeId,auth.userId]);
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id)
    VALUES($1,$2,'inventory.start',$3)`,[auth.storeId,auth.userId,count.rows[0].id]);
   return {id:count.rows[0].id,active:true};
  });
  return reply.code(out.replayed?200:201).send(out.result);
 });
 app.post<{Params:{id:string};Body:{variant_id:string;counted_on_hand:number}}>('/v1/management/inventory-counts/:id/lines',{
  schema:{params:idParams,body:{type:'object',additionalProperties:false,required:['variant_id','counted_on_hand'],properties:{
   variant_id:{type:'string',pattern:uuid},counted_on_hand:{type:'integer',minimum:0,maximum:1000000000}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'stock.count'))return reply;
  const auth=request.authContext!,id=request.params.id,body=request.body;
  const out=await withIdempotentTransaction(db,auth,'inventory.line:'+id,
    requireIdempotencyKey(request.headers['idempotency-key']),body,async client=>{
   const count=await client.query(`SELECT id FROM inventory_count_sessions WHERE store_id=$1 AND id=$2 AND closed_at IS NULL FOR UPDATE`,[auth.storeId,id]);
   if(!count.rowCount)throw new DomainError(409,'COUNT_CLOSED','Inventário não está aberto');
   const v=await client.query(`SELECT id FROM product_variants WHERE store_id=$1 AND id=$2`,[auth.storeId,body.variant_id]);
   if(!v.rowCount)throw new DomainError(404,'VARIANT_NOT_FOUND','SKU não encontrado');
   await client.query(`INSERT INTO stock_balances(store_id,variant_id,on_hand,reserved) VALUES($1,$2,0,0)
    ON CONFLICT(store_id,variant_id) DO NOTHING`,[auth.storeId,body.variant_id]);
   const b=await client.query<{on_hand:string;reserved:string}>(`SELECT on_hand::text,reserved::text FROM stock_balances
    WHERE store_id=$1 AND variant_id=$2 FOR UPDATE`,[auth.storeId,body.variant_id]);
   const existing=await client.query<{expected_on_hand:string}>(`SELECT expected_on_hand::text
    FROM inventory_count_lines WHERE store_id=$1 AND count_id=$2 AND variant_id=$3 FOR UPDATE`,
    [auth.storeId,id,body.variant_id]);
   // Recontar um SKU atualiza o snapshot observado; venda concorrente só é reconciliada após nova contagem explícita.
   const expected=Number(b.rows[0].on_hand);
   reconcileCount({expected,current:Number(b.rows[0].on_hand),reserved:Number(b.rows[0].reserved),counted:body.counted_on_hand});
   await client.query(`INSERT INTO inventory_count_lines(store_id,count_id,variant_id,expected_on_hand,counted_on_hand,counted_by)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(store_id,count_id,variant_id)
    DO UPDATE SET expected_on_hand=excluded.expected_on_hand,counted_on_hand=excluded.counted_on_hand,counted_by=excluded.counted_by,updated_at=now()`,[
    auth.storeId,id,body.variant_id,expected,body.counted_on_hand,auth.userId
   ]);
   return {variant_id:body.variant_id,expected_on_hand:expected,counted_on_hand:body.counted_on_hand};
  });
  return reply.code(out.replayed?200:201).send(out.result);
 });
 app.post<{Params:{id:string}}>('/v1/management/inventory-counts/:id/close',{
  schema:{params:idParams}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'stock.adjust'))return reply;
  const auth=request.authContext!,id=request.params.id;
  const out=await withIdempotentTransaction(db,auth,'inventory.close:'+id,
   requireIdempotencyKey(request.headers['idempotency-key']),{},async client=>{
   const c=await client.query(`SELECT id FROM inventory_count_sessions WHERE store_id=$1 AND id=$2 AND closed_at IS NULL FOR UPDATE`,[auth.storeId,id]);
   if(!c.rowCount)throw new DomainError(409,'COUNT_CLOSED','Inventário já foi encerrado');
   const lines=await client.query<{variant_id:string;expected_on_hand:string;counted_on_hand:string}>(`
    SELECT variant_id::text,expected_on_hand::text,counted_on_hand::text FROM inventory_count_lines
    WHERE store_id=$1 AND count_id=$2 ORDER BY variant_id`,[auth.storeId,id]);
   if(!lines.rowCount)throw new DomainError(422,'COUNT_EMPTY','Registre ao menos uma peça antes de concluir');
   let adjusted=0,missing=0,extra=0;
   for(const line of lines.rows){
    const bal=await client.query<{on_hand:string;reserved:string}>(`SELECT on_hand::text,reserved::text FROM stock_balances
     WHERE store_id=$1 AND variant_id=$2 FOR UPDATE`,[auth.storeId,line.variant_id]);
    if(!bal.rowCount)throw new DomainError(409,'COUNT_STALE','SKU sem saldo atual. Reconte.');
    const delta=reconcileCount({expected:Number(line.expected_on_hand),current:Number(bal.rows[0].on_hand),
     reserved:Number(bal.rows[0].reserved),counted:Number(line.counted_on_hand)});
    if(delta){
     await client.query(`UPDATE stock_balances SET on_hand=$3,revision=revision+1
      WHERE store_id=$1 AND variant_id=$2`,[auth.storeId,line.variant_id,Number(line.counted_on_hand)]);
     await client.query(`INSERT INTO stock_movements(store_id,variant_id,source_type,source_id,movement_kind,qty_delta)
      VALUES($1,$2,'inventory_count',$3,'adjustment',$4)`,[auth.storeId,line.variant_id,id,delta]);
     adjusted++;if(delta<0)missing-=delta;else extra+=delta;
    }
   }
   await client.query(`UPDATE inventory_count_sessions SET closed_at=now(),closed_by=$3 WHERE store_id=$1 AND id=$2`,[auth.storeId,id,auth.userId]);
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
    VALUES($1,$2,'inventory.close',$3,$4::jsonb)`,[auth.storeId,auth.userId,id,JSON.stringify({adjusted,missing,extra})]);
   return {id,closed:true,adjusted,missing,extra};
  });
  return out.result;
 });
}
