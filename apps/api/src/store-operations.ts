import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { requirePermission } from './auth.ts';
import { DomainError, requireIdempotencyKey, withIdempotentTransaction } from './transactions.ts';

const uuid = {type:'string', pattern:'^[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$'};
const photoParams = {type:'object', required:['id','productId'], properties:{id:uuid,productId:uuid}};
const idParams = {type:'object', required:['id'], properties:{id:uuid}};

export function registerStoreOperations(app: FastifyInstance, db: Pool) {
  app.post<{Params:{id:string};Body:{paper_mm:58|80|210}}>('/v1/sales/:id/print-requests', {
    schema:{params:idParams, body:{type:'object', additionalProperties:false, required:['paper_mm'],
      properties:{paper_mm:{type:'integer', enum:[58,80,210]}}}},
  }, async (request, reply) => {
    if (requirePermission(request, reply, 'sale.read')) return reply;
    const auth = request.authContext!;
    const key = requireIdempotencyKey(request.headers['idempotency-key']);
    const result = await withIdempotentTransaction(db, auth, 'receipt.print:' + request.params.id, key,
      request.body, async client => {
        const sale = await client.query('SELECT cashier_id FROM sales WHERE store_id=$1 AND id=$2',
          [auth.storeId, request.params.id]);
        if (!sale.rowCount || (!auth.roles.includes('manager') && sale.rows[0].cashier_id !== auth.userId))
          throw new DomainError(404, 'SALE_NOT_FOUND', 'Venda não encontrada');
        const job = await client.query<{id:string}>(`INSERT INTO receipt_print_requests
          (store_id, sale_id, actor_id, paper_mm) VALUES ($1,$2,$3,$4) RETURNING id`,
          [auth.storeId, request.params.id, auth.userId, request.body.paper_mm]);
        await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
          VALUES ($1,$2,'receipt.print.request',$3,$4::jsonb)`, [auth.storeId, auth.userId, request.params.id,
          JSON.stringify({request_id:job.rows[0].id, paper_mm:request.body.paper_mm})]);
        return job.rows[0];
      });
    return reply.code(201).send(result.result);
  });

  app.get('/v1/management/sales-summary', async (request, reply) => {
    if (requirePermission(request, reply, 'finance.read')) return reply;
    const result = await db.query(`WITH store AS (
        SELECT id,timezone,(date_trunc('day',now() AT TIME ZONE timezone)-interval '29 days') AT TIME ZONE timezone AS since
        FROM stores WHERE id=$1
      ), movements AS (
        SELECT (r.occurred_at AT TIME ZONE st.timezone)::date AS day,r.sale_count,r.gross_cents,r.refund_cents AS refunded_cents
        FROM retail_revenue_events r JOIN store st ON st.id=r.store_id WHERE r.occurred_at>=st.since
      )
      SELECT day::text,sum(sale_count)::integer AS sale_count,sum(gross_cents)::text AS gross_cents,
        sum(refunded_cents)::text AS refunded_cents
      FROM movements GROUP BY day ORDER BY day DESC`,[request.authContext!.storeId]);
    return {days:result.rows};
  });

  app.get('/v1/management/suppliers', async (request, reply) => {
    if (requirePermission(request, reply, 'purchase.read')) return reply;
    const result = await db.query('SELECT id,name FROM suppliers WHERE store_id=$1 ORDER BY lower(name),id',
      [request.authContext!.storeId]);
    return {suppliers:result.rows};
  });

  app.post<{Body:{name:string}}>('/v1/management/suppliers', {
    schema:{body:{type:'object', additionalProperties:false, required:['name'],
      properties:{name:{type:'string', minLength:1, maxLength:120, pattern:'\\S'}}}},
  }, async (request, reply) => {
    if (requirePermission(request, reply, 'purchase.write')) return reply;
    const auth = request.authContext!;
    const key = requireIdempotencyKey(request.headers['idempotency-key']);
    const name = request.body.name.trim();
    const result = await withIdempotentTransaction(db, auth, 'supplier.create', key, {name}, async client => {
      const supplier = await client.query<{id:string;name:string}>(
        'INSERT INTO suppliers(store_id,name) VALUES ($1,$2) RETURNING id,name', [auth.storeId, name]);
      await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id)
        VALUES ($1,$2,'supplier.create',$3)`, [auth.storeId, auth.userId, supplier.rows[0].id]);
      return supplier.rows[0];
    });
    return reply.code(201).send(result.result);
  });

  app.put<{Params:{id:string};Body:{published:boolean}}>('/v1/management/storefront/variants/:id', {
    schema:{params:idParams, body:{type:'object', additionalProperties:false, required:['published'],
      properties:{published:{type:'boolean'}}}},
  }, async (request, reply) => {
    if (requirePermission(request, reply, 'storefront.publish')) return reply;
    const auth = request.authContext!;
    const key = requireIdempotencyKey(request.headers['idempotency-key']);
    const result = await withIdempotentTransaction(db, auth, 'storefront.publish:' + request.params.id, key,
      request.body, async client => {
        const updated = await client.query(`UPDATE product_variants SET storefront_published=$3
          WHERE store_id=$1 AND id=$2 RETURNING id`, [auth.storeId, request.params.id, request.body.published]);
        if (!updated.rowCount) throw new DomainError(404, 'VARIANT_NOT_FOUND', 'Variação não encontrada');
        await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
          VALUES ($1,$2,'storefront.publish',$3,$4::jsonb)`,
          [auth.storeId, auth.userId, request.params.id, JSON.stringify(request.body)]);
        return request.body;
      });
    return result.result;
  });

  app.get<{Params:{id:string};Querystring:{after?:string}}>('/v1/storefront/:id', {
    schema:{params:idParams, querystring:{type:'object', additionalProperties:false, properties:{after:uuid}}},
  }, async (request, reply) => {
    const result = await db.query(`SELECT v.id,p.name,v.color,v.size,v.price_cents::text,
      CASE WHEN photo.product_id IS NOT NULL
        THEN '/v1/storefront/' || p.store_id || '/products/' || p.id || '/photo'
      END AS photo_url,
      coalesce(b.on_hand > b.reserved,false) AS available
      FROM product_variants v JOIN products p ON p.id=v.product_id AND p.store_id=v.store_id
      LEFT JOIN stock_balances b ON b.store_id=v.store_id AND b.variant_id=v.id
      LEFT JOIN product_photos photo ON photo.store_id=v.store_id AND photo.product_id=v.product_id
      WHERE v.store_id=$1 AND v.storefront_published AND ($2::uuid IS NULL OR v.id>$2)
      ORDER BY v.id LIMIT 51`, [request.params.id, request.query.after ?? null]);
    const store = await db.query<{pickup_enabled:boolean}>('SELECT pickup_enabled FROM stores WHERE id=$1', [request.params.id]);
    return reply.header('Cache-Control','no-store').send({
      items:result.rows.slice(0,50), next:result.rows.length > 50 ? result.rows[49].id : null,
      pickup_enabled:store.rows[0]?.pickup_enabled ?? false,
    });
  });

  app.get<{Params:{id:string;productId:string}}>('/v1/storefront/:id/products/:productId/photo', {
    schema:{params:photoParams},
  }, async (request,reply) => {
    const {id,productId}=request.params;
    const photograph=await db.query<{bytes:Buffer;mime:string}>(`SELECT
      coalesce(p.thumb_bytes,p.image_bytes) AS bytes,coalesce(p.thumb_type,p.content_type) AS mime
      FROM product_photos p WHERE p.store_id=$1 AND p.product_id=$2 AND EXISTS (
        SELECT 1 FROM product_variants v
        WHERE v.store_id=p.store_id AND v.product_id=p.product_id AND v.storefront_published
      )`,[id,productId]);
    const image=photograph.rows[0];
    if(!image)throw new DomainError(404,'PHOTO_NOT_FOUND','Foto indisponível na vitrine');
    return reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').type(image.mime).send(image.bytes);
  });
}
