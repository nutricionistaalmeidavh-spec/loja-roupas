import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { requirePermission } from './auth.ts';

type Row = {
  product_id:string; name:string; category:string;
  variant_id:string; sku:string; barcode:string|null; color:string; size:string;
  price_cents:string; available:string;
};

export function registerCatalog(app: FastifyInstance, db: Pick<Pool,'query'>) {
  app.get<{ Querystring: { query?: string; limit?: number } }>('/v1/catalog/products', {
    schema: { querystring: {
      type:'object', additionalProperties: false,
      properties:{query:{type:'string',maxLength:100},limit:{type:'integer',minimum:1,maximum:50,default:30}}
    }}
  }, async(request,reply) => {
    if (requirePermission(request, reply, 'catalog.read')) return reply;
    const storeId=request.authContext!.storeId;
    const {query='',limit=30}=request.query;
    const rows=await db.query<Row>(`SELECT p.id::text AS product_id,p.name,p.category,
      v.id::text AS variant_id,v.sku,v.barcode,v.color,v.size,v.price_cents::text,
      (coalesce(s.on_hand,0)-coalesce(s.reserved,0))::text AS available
      FROM (
        SELECT DISTINCT p0.id,p0.name,p0.category
        FROM products p0
        JOIN product_variants v0 ON v0.product_id=p0.id AND v0.store_id=p0.store_id
        WHERE p0.store_id=$1 AND ($2='' OR p0.name ILIKE '%'||$2||'%'
          OR v0.sku ILIKE '%'||$2||'%' OR v0.barcode=$2)
        ORDER BY p0.name,p0.id LIMIT $3
      ) p
      JOIN product_variants v ON v.product_id=p.id AND v.store_id=$1
      LEFT JOIN stock_balances s ON s.variant_id=v.id AND s.store_id=v.store_id
      ORDER BY p.name,p.id,v.sku`,[storeId,query.trim(),limit]);
    const byId = new Map<string,{id:string;name:string;category:string;variants:Array<unknown>}>();
    for (const row of rows.rows) {
      if(!byId.has(row.product_id))byId.set(row.product_id,{id:row.product_id,name:row.name,category:row.category,variants:[]});
      const cents=Number(row.price_cents), available=Number(row.available);
      if(!Number.isSafeInteger(cents)||!Number.isSafeInteger(available))throw new Error('Valor canônico fora do limite');
      byId.get(row.product_id)!.variants.push({
        id:row.variant_id,product_id:row.product_id,sku:row.sku,barcode:row.barcode,
        color:row.color,size:row.size,price_cents:cents,available
      });
    }
    return { items:[...byId.values()], next_cursor:null };
  });
}
