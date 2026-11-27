import type {Pool,PoolClient} from 'pg';
import type {AuthContext} from './auth.ts';
import {DomainError} from './transactions.ts';

type Queryable=Pick<PoolClient,'query'>;
const changed=`INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload)
 VALUES($1,'inventory.stock.changed.v1',$2,$3,$4::jsonb)`;

async function unreserve(db:Queryable,storeId:string,variantId:string,quantity:number,payload:object){
 const b=await db.query<{revision:string}>(`UPDATE stock_balances SET reserved=reserved-$3,revision=revision+1
  WHERE store_id=$1 AND variant_id=$2 AND reserved>=$3 RETURNING revision::text`,[storeId,variantId,quantity]);
 if(!b.rowCount)throw new DomainError(409,'INCONSISTENT_STOCK','Saldo reservado inconsistente');
 await db.query(changed,[storeId,variantId,Number(b.rows[0].revision),JSON.stringify({...payload,reserved_delta:-quantity})]);
}

/** Reserva o estoque de um pedido de retirada da vitrine. Falha se alguma peça ficou indisponível. */
export async function reservePickupOrder(db:Queryable,storeId:string,orderId:string,lines:ReadonlyArray<{variant_id:string;quantity:number}>){
 for(const line of lines){
  const b=await db.query<{revision:string}>(`UPDATE stock_balances SET reserved=reserved+$3,revision=revision+1
   WHERE store_id=$1 AND variant_id=$2 AND on_hand-reserved>=$3 RETURNING revision::text`,[storeId,line.variant_id,line.quantity]);
  if(!b.rowCount)throw new DomainError(409,'OUT_OF_STOCK','Uma peça ficou indisponível. Atualize a vitrine e revise o pedido.');
  await db.query(changed,[storeId,line.variant_id,Number(b.rows[0].revision),
   JSON.stringify({pickup_order_id:orderId,reserved_delta:line.quantity})]);
 }
}

/** Libera a reserva de um pedido de retirada (venda, cancelamento ou expiração). Idempotente. */
export async function releasePickupReservation(db:Queryable,storeId:string,orderId:string,reason:'sold'|'cancelled'|'expired'){
 const order=await db.query(`UPDATE pickup_orders SET reservation_released_at=now()
  WHERE store_id=$1 AND id=$2 AND reservation_released_at IS NULL RETURNING id`,[storeId,orderId]);
 if(!order.rowCount)return false;
 const lines=await db.query<{variant_id:string;quantity:number}>(`SELECT variant_id::text,quantity
  FROM pickup_order_lines WHERE store_id=$1 AND order_id=$2 ORDER BY variant_id`,[storeId,orderId]);
 for(const line of lines.rows)await unreserve(db,storeId,line.variant_id,Number(line.quantity),{pickup_order_id:orderId,reason});
 return true;
}

/** Libera reservas vencidas: reservas de balcão após a validade e pedidos de retirada após 48 h. */
export async function sweepExpiredReservations(db:Queryable,storeId:string){
 const holds=await db.query<{id:string;variant_id:string;quantity:number}>(`UPDATE stock_holds
  SET released_at=now(),release_reason='expired'
  WHERE id IN (SELECT id FROM stock_holds WHERE store_id=$1 AND released_at IS NULL AND expires_at<=now()
   ORDER BY id FOR UPDATE SKIP LOCKED)
  RETURNING id::text,variant_id::text,quantity`,[storeId]);
 for(const hold of holds.rows)await unreserve(db,storeId,hold.variant_id,Number(hold.quantity),{hold_id:hold.id,reason:'expired'});
 const orders=await db.query<{id:string}>(`SELECT id::text FROM pickup_orders
  WHERE store_id=$1 AND reservation_released_at IS NULL AND sale_id IS NULL
   AND (cancelled_at IS NOT NULL OR created_at<=now()-interval '48 hours')
  ORDER BY id FOR UPDATE SKIP LOCKED`,[storeId]);
 for(const order of orders.rows)await releasePickupReservation(db,storeId,order.id,'expired');
 return {holds:holds.rowCount??0,pickups:orders.rowCount??0};
}

/** Converte reservas de balcão na venda: a peça reservada deixa de bloquear a própria venda. */
export async function consumeHolds(db:Queryable,auth:AuthContext,holdIds:readonly string[],
 lines:ReadonlyArray<{variant_id:string;quantity:number}>){
 const wanted=new Map(lines.map(l=>[l.variant_id.toLowerCase(),l.quantity]));
 const used=new Map<string,number>();
 for(const id of [...holdIds].sort()){
  const hold=await db.query<{variant_id:string;quantity:number}>(`UPDATE stock_holds
   SET released_at=now(),release_reason='sold' WHERE store_id=$1 AND id=$2 AND released_at IS NULL
   RETURNING variant_id::text,quantity`,[auth.storeId,id]);
  if(!hold.rowCount)throw new DomainError(409,'HOLD_NOT_FOUND','Reserva inexistente, vencida ou já usada');
  const variant=hold.rows[0].variant_id.toLowerCase(),qty=Number(hold.rows[0].quantity);
  const total=(used.get(variant)??0)+qty;
  if(!wanted.has(variant)||total>wanted.get(variant)!)
   throw new DomainError(409,'HOLD_MISMATCH','A reserva não corresponde às peças da venda');
  used.set(variant,total);
  await unreserve(db,auth.storeId,variant,qty,{hold_id:id,reason:'sold'});
  await db.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
   VALUES($1,$2,'stock.hold.sold',$3,$4::jsonb)`,[auth.storeId,auth.userId,id,JSON.stringify({variant_id:variant,quantity:qty})]);
 }
}

/** Varredura em transação própria, para leituras fora de uma operação. */
export async function sweepExpiredReservationsTx(pool:Pool,storeId:string){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const result=await sweepExpiredReservations(client,storeId);
  await client.query('COMMIT');
  return result;
 }catch(error){await client.query('ROLLBACK');throw error;}
 finally{client.release();}
}
