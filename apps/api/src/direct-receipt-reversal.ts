import type {FastifyInstance} from 'fastify';
import type {Pool} from 'pg';
import {DomainError,requireIdempotencyKey,withIdempotentTransaction} from './transactions.ts';

const idPattern='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
export function registerDirectReceiptReversal(app:FastifyInstance,db:Pool){
 app.post<{Params:{id:string};Body:{reason:string}}>('/v1/stock/direct-receipt/:id/reverse',{
  schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',pattern:idPattern}}},
   body:{type:'object',additionalProperties:false,required:['reason'],properties:{reason:{type:'string',minLength:8,maxLength:250}}}}
 },async(request,reply)=>{
  const auth=request.authContext!;
  if(!auth.roles.includes('manager'))return reply.code(403).send({code:'FORBIDDEN',message:'Somente gestores podem estornar entradas diretas'});
  const reason=request.body.reason.trim();
  if(reason.length<8)throw new DomainError(422,'REVERSAL_REASON','Justificativa obrigatória');
  const out=await withIdempotentTransaction(db,auth,'stock.direct_receipt.reverse:'+request.params.id,
   requireIdempotencyKey(request.headers['idempotency-key']),{reason},async client=>{
    const original=await client.query<{id:string;variant_id:string;qty_delta:string}>(`SELECT id::text,variant_id::text,qty_delta::text
      FROM stock_movements WHERE store_id=$1 AND id=$2 AND source_type='direct_receipt' AND movement_kind='receipt' FOR UPDATE`,
      [auth.storeId,request.params.id]);
    if(!original.rowCount)throw new DomainError(404,'RECEIPT_NOT_FOUND','Entrada direta não encontrada');
    const item=original.rows[0],qty=Number(item.qty_delta);
    if(!Number.isSafeInteger(qty)||qty<=0)throw new DomainError(409,'INVALID_RECEIPT','Quantidade original inválida');
    const previous=await client.query('SELECT 1 FROM stock_movements WHERE store_id=$1 AND source_type=$2 AND source_id=$3 AND variant_id=$4',
      [auth.storeId,'direct_receipt_reversal',item.id,item.variant_id]);
    if(previous.rowCount)throw new DomainError(409,'ALREADY_REVERSED','Entrada já estornada');
    const balance=await client.query<{revision:string;on_hand:string;reserved:string}>(`UPDATE stock_balances SET on_hand=on_hand-$3,revision=revision+1
      WHERE store_id=$1 AND variant_id=$2 AND on_hand-reserved >= $3
      RETURNING revision::text,on_hand::text,reserved::text`,[auth.storeId,item.variant_id,qty]);
    if(!balance.rowCount)throw new DomainError(409,'INSUFFICIENT_STOCK','Estorno bloqueado: saldo disponível insuficiente. Faça conciliação de estoque.');
    const movement=await client.query<{id:string}>(`INSERT INTO stock_movements(store_id,variant_id,source_type,source_id,movement_kind,qty_delta)
      VALUES($1,$2,'direct_receipt_reversal',$3,'adjustment',$4) RETURNING id::text`,
      [auth.storeId,item.variant_id,item.id,-qty]);
    await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
      VALUES($1,$2,'inventory.direct_receipt.reversal',$3,$4::jsonb)`,
      [auth.storeId,auth.userId,item.variant_id,JSON.stringify({original_movement_id:item.id,reversal_movement_id:movement.rows[0].id,quantity:qty,reason})]);
    await client.query(`INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload)
      VALUES($1,'inventory.stock.changed.v1',$2,$3,$4::jsonb)`,
      [auth.storeId,item.variant_id,Number(balance.rows[0].revision),JSON.stringify({variant_id:item.variant_id,reversal_of:item.id})]);
    return {movement_id:movement.rows[0].id,reversed_movement_id:item.id,on_hand:Number(balance.rows[0].on_hand)};
   });
  return out.result;
 });
}
