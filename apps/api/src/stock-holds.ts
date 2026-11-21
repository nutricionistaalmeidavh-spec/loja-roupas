import type { FastifyInstance } from 'fastify';
import type {Pool, PoolClient} from 'pg';
import { requirePermission } from './auth.ts';
import type { AuthContext } from './auth.ts';
import {holdState} from '@loja/domain/operations';
import { DomainError, requireIdempotencyKey, withIdempotentTransaction } from './transactions.ts';

const uuid = {type:'string', pattern:'^[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$'};

async function recordChange(client:PoolClient, auth:AuthContext, holdId:string, variantId:string,
  revision:string, quantityDelta:number) {
  const action = quantityDelta > 0 ? 'stock.hold.created' : 'stock.hold.released';
  const detail = JSON.stringify({hold_id:holdId, variant_id:variantId, reserved_delta:quantityDelta});
  await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
    VALUES($1,$2,$3,$4,$5::jsonb)`, [auth.storeId,auth.userId,action,holdId,detail]);
  await client.query(`INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload)
    VALUES($1,'inventory.stock.changed.v1',$2,$3,$4::jsonb)`, [auth.storeId,variantId,revision,
    JSON.stringify({variant_id:variantId,revision:Number(revision),hold_id:holdId,reserved_delta:quantityDelta})]);
}

export function registerStockHolds(app:FastifyInstance, db:Pool) {
  app.get('/v1/stock/holds', async (request,reply) => {
    if (requirePermission(request,reply,'reservation.create')) return reply;
    const holds = await db.query<{id:string;quantity:number;sku:string;created_at:Date;released_at:Date|null;stale:boolean}>(`SELECT h.id,h.quantity,v.sku,h.created_at,h.released_at,
      h.created_at<=now()-interval '24 hours' AS stale FROM stock_holds h
      JOIN product_variants v ON v.store_id=h.store_id AND v.id=h.variant_id
      WHERE h.store_id=$1 AND h.released_at IS NULL ORDER BY h.created_at,h.id LIMIT 100`,
      [request.authContext!.storeId]);
    return {holds:holds.rows.map(hold=>({id:hold.id,quantity:hold.quantity,sku:hold.sku,
      created_at:hold.created_at,stale:hold.stale,
      state:holdState({released_at:hold.released_at?.toISOString()??null})}))};
  });

  app.post<{Body:{variant_id:string;quantity:number}}>('/v1/stock/holds', {
    schema:{body:{type:'object',additionalProperties:false,required:['variant_id','quantity'],properties:{
      variant_id:uuid,quantity:{type:'integer',minimum:1,maximum:999},
    }}},
  }, async (request,reply) => {
    if (requirePermission(request,reply,'reservation.create')) return reply;
    const auth = request.authContext!;
    const key = requireIdempotencyKey(request.headers['idempotency-key']);
    const {variant_id,quantity} = request.body;
    const out = await withIdempotentTransaction(db,auth,'stock.hold',key,request.body,async client => {
      const balance = await client.query<{revision:string}>(`UPDATE stock_balances
        SET reserved=reserved+$3,revision=revision+1
        WHERE store_id=$1 AND variant_id=$2 AND on_hand-reserved >= $3 RETURNING revision`,
        [auth.storeId,variant_id,quantity]);
      if (!balance.rowCount) throw new DomainError(409,'INSUFFICIENT_STOCK','Estoque disponível insuficiente');
      const result = await client.query<{id:string}>(`INSERT INTO stock_holds(store_id,variant_id,actor_id,quantity)
        VALUES($1,$2,$3,$4) RETURNING id`, [auth.storeId,variant_id,auth.userId,quantity]);
      await recordChange(client,auth,result.rows[0].id,variant_id,balance.rows[0].revision,quantity);
      return result.rows[0];
    });
    return reply.code(201).send(out.result);
  });

  app.post<{Params:{id:string}}>('/v1/stock/holds/:id/release', {
    schema:{params:{type:'object',required:['id'],properties:{id:uuid}}},
  }, async (request,reply) => {
    if (requirePermission(request,reply,'reservation.create')) return reply;
    const auth = request.authContext!;
    const {id} = request.params;
    const key = requireIdempotencyKey(request.headers['idempotency-key']);
    const out = await withIdempotentTransaction(db,auth,'stock.hold.release:'+id,key,{},async client => {
      const result = await client.query<{variant_id:string;quantity:number}>(`UPDATE stock_holds
        SET released_at=now() WHERE store_id=$1 AND id=$2 AND released_at IS NULL RETURNING variant_id,quantity`,
        [auth.storeId,id]);
      if (!result.rowCount) throw new DomainError(404,'HOLD_NOT_FOUND','Reserva ativa não encontrada');
      const {variant_id,quantity} = result.rows[0];
      const balance = await client.query<{revision:string}>(`UPDATE stock_balances
        SET reserved=reserved-$3,revision=revision+1
        WHERE store_id=$1 AND variant_id=$2 AND reserved >= $3 RETURNING revision`,
        [auth.storeId,variant_id,quantity]);
      if (!balance.rowCount) throw new DomainError(409,'INCONSISTENT_STOCK','Saldo reservado inconsistente');
      await recordChange(client,auth,id,variant_id,balance.rows[0].revision,-quantity);
      return {id,released:true};
    });
    return out.result;
  });
}
