import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { stableFingerprint } from '@loja/domain/catalog';
import { requirePermission } from './auth.ts';
import { DomainError, requireIdempotencyKey, withIdempotentTransaction } from './transactions.ts';

const uuid = {type:'string',pattern:'^[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$'};
const params = {type:'object',required:['id'],properties:{id:uuid}};
type Line = {variant_id:string;quantity:number};
type OrderRow = {id:string;sale_id:string|null;quoted_total_cents:string;expired:boolean};
type Queryable = Pick<PoolClient,'query'>;

async function pendingOrder(db:Queryable, storeId:string, id:string, lock=false) {
  const order = await db.query<OrderRow>(`SELECT id,sale_id,quoted_total_cents,
    created_at <= now() - interval '48 hours' AS expired FROM pickup_orders
    WHERE store_id=$1 AND id=$2 ${lock?'FOR UPDATE':''}`,[storeId,id]);
  const found = order.rows[0];
  if (!found) throw new DomainError(404,'ORDER_NOT_FOUND','Pedido de retirada não encontrado');
  if (found.sale_id) throw new DomainError(409,'ORDER_SOLD','Pedido de retirada já finalizado');
  if (found.expired) throw new DomainError(409,'ORDER_EXPIRED','Código de retirada expirado');
  const lines = await db.query<Line>(`SELECT variant_id,quantity FROM pickup_order_lines
    WHERE store_id=$1 AND order_id=$2 ORDER BY variant_id`,[storeId,id]);
  return {id:found.id,quoted_total_cents:found.quoted_total_cents,lines:lines.rows};
}

export async function validatePickupSale(db:PoolClient, storeId:string, id:string, sold:readonly Line[]) {
  const order = await pendingOrder(db,storeId,id,true);
  const quantities = new Map(sold.map(line => [line.variant_id.toLowerCase(),line.quantity]));
  if (sold.length !== quantities.size || order.lines.length !== quantities.size || order.lines.some(line => quantities.get(line.variant_id) !== line.quantity))
    throw new DomainError(409,'ORDER_ITEMS_CHANGED','Os itens da venda devem corresponder ao pedido de retirada');
}

export function registerPickupOrders(app:FastifyInstance, db:Pool) {
  app.put<{Body:{enabled:boolean}}>('/v1/management/storefront/pickup', {
    schema:{body:{type:'object',additionalProperties:false,required:['enabled'],properties:{enabled:{type:'boolean'}}}},
  }, async (request,reply) => {
    if (requirePermission(request,reply,'storefront.publish')) return reply;
    const auth = request.authContext!, key = requireIdempotencyKey(request.headers['idempotency-key']);
    const {enabled} = request.body;
    const out = await withIdempotentTransaction(db,auth,'storefront.pickup',key,{enabled},async client => {
      await client.query('UPDATE stores SET pickup_enabled=$2 WHERE id=$1',[auth.storeId,enabled]);
      await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
        VALUES($1,$2,'storefront.pickup',$1,$3::jsonb)`,[auth.storeId,auth.userId,JSON.stringify({enabled})]);
      return {enabled};
    });
    return out.result;
  });

  app.post<{Params:{id:string};Body:{request_id:string;lines:Line[]}}>('/v1/storefront/:id/pickup-orders', {
    schema:{params,body:{type:'object',additionalProperties:false,required:['request_id','lines'],properties:{
      request_id:uuid, lines:{type:'array',minItems:1,maxItems:10,items:{type:'object',additionalProperties:false,
        required:['variant_id','quantity'],properties:{variant_id:uuid,quantity:{type:'integer',minimum:1,maximum:10}}}},
    }}},
  }, async (request,reply) => {
    const storeId = request.params.id;
    const lines = request.body.lines.map(line=>({...line,variant_id:line.variant_id.toLowerCase()}))
      .sort((left,right)=>left.variant_id.localeCompare(right.variant_id));
    if (new Set(lines.map(line=>line.variant_id)).size !== lines.length)
      throw new DomainError(422,'DUPLICATE_VARIANT','Junte quantidades da mesma variante');
    const fingerprint = stableFingerprint(lines);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const store = await client.query<{pickup_enabled:boolean}>('SELECT pickup_enabled FROM stores WHERE id=$1 FOR NO KEY UPDATE',[storeId]);
      const previous = await client.query<{id:string;fingerprint:string;quoted_total_cents:string}>(`SELECT id,fingerprint,quoted_total_cents
        FROM pickup_orders WHERE store_id=$1 AND submission_key=$2`,[storeId,request.body.request_id]);
      if (previous.rowCount) {
        const {id,fingerprint:existing,quoted_total_cents} = previous.rows[0];
        if (existing !== fingerprint) throw new DomainError(409,'IDEMPOTENCY_CONFLICT','Chave reutilizada para outro pedido');
        await client.query('COMMIT');
        return reply.code(201).send({id,quoted_total_cents});
      }
      if (!store.rows[0]?.pickup_enabled) throw new DomainError(404,'PICKUP_DISABLED','Retirada indisponível');
      const quota = await client.query<{too_many:boolean}>(`SELECT count(*) >= 20 AS too_many FROM pickup_orders
        WHERE store_id=$1 AND created_at >= now()-interval '1 minute'`,[storeId]);
      if (quota.rows[0].too_many) throw new DomainError(429,'PICKUP_RATE_LIMIT','Aguarde um minuto antes de repetir o envio');
      const variants = await client.query<{id:string;price_cents:string;available:string}>(`SELECT v.id,v.price_cents,
        (b.on_hand-b.reserved)::text AS available FROM product_variants v
        JOIN stock_balances b ON b.store_id=v.store_id AND b.variant_id=v.id
        WHERE v.store_id=$1 AND v.id=ANY($2::uuid[]) AND v.storefront_published`,[storeId,lines.map(line=>line.variant_id)]);
      const byId = new Map(variants.rows.map(row=>[row.id,row]));
      let total = 0n;
      for (const line of lines) {
        const item = byId.get(line.variant_id);
        if (!item || BigInt(item.available) < BigInt(line.quantity))
          throw new DomainError(409,'OUT_OF_STOCK','Uma peça ficou indisponível. Atualize a vitrine e revise o pedido.');
        total += BigInt(item.price_cents)*BigInt(line.quantity);
      }
      if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new DomainError(422,'TOTAL_OVERFLOW','Total excede os limites');
      const created = await client.query<{id:string;quoted_total_cents:string}>(`INSERT INTO pickup_orders
        (store_id,submission_key,fingerprint,quoted_total_cents) VALUES($1,$2,$3,$4) RETURNING id,quoted_total_cents`,
        [storeId,request.body.request_id,fingerprint,total.toString()]);
      const order = created.rows[0];
      for (const line of lines) await client.query(`INSERT INTO pickup_order_lines(order_id,store_id,variant_id,quantity)
        VALUES($1,$2,$3,$4)`,[order.id,storeId,line.variant_id,line.quantity]);
      await client.query('COMMIT');
      return reply.code(201).send(order);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.get<{Params:{id:string}}>('/v1/pickup-orders/:id', {schema:{params}}, async (request,reply) => {
    if (requirePermission(request,reply,'sale.commit')) return reply;
    return pendingOrder(db,request.authContext!.storeId,request.params.id);
  });
}
