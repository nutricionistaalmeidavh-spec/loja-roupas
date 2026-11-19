import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type { AuthContext } from './auth.ts';
import { requirePermission } from './auth.ts';
import { DomainError, requireIdempotencyKey, withIdempotentTransaction } from './transactions.ts';

const uuid = {type:'string',pattern:'^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'};
const params = {type:'object',required:['id'],properties:{id:uuid}};
const key = (request:FastifyRequest) => requireIdempotencyKey(request.headers['idempotency-key']);
type Purchase = {supplier_id:string;variant_id:string;quantity:number;unit_cost_cents:number};

async function audit(client:PoolClient, auth:AuthContext, action:string, id:string) {
  await client.query('INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id) VALUES($1,$2,$3,$4)',
    [auth.storeId,auth.userId,action,id]);
}

export function registerOperationalCompletion(app:FastifyInstance,db:Pool) {
  app.get('/v1/management/print-queue',async(request,reply)=>{
    if(requirePermission(request,reply,'print.manage'))return reply;
    const result=await db.query(`SELECT j.id,j.sale_id,j.paper_mm,j.created_at,s.sale_number::text
      FROM receipt_print_requests j JOIN sales s ON s.id=j.sale_id AND s.store_id=j.store_id
      WHERE j.store_id=$1 AND j.completed_at IS NULL ORDER BY j.created_at,j.id LIMIT 100`,
      [request.authContext!.storeId]);
    return {jobs:result.rows};
  });

  app.post<{Params:{id:string}}>('/v1/management/print-queue/:id/complete',{schema:{params}},async(request,reply)=>{
    if(requirePermission(request,reply,'print.manage'))return reply;
    const auth=request.authContext!,{id}=request.params;
    const out=await withIdempotentTransaction(db,auth,'print.complete:'+id,key(request),{},async client=>{
      const result=await client.query(`UPDATE receipt_print_requests SET completed_at=now(),completed_by=$3
        WHERE store_id=$1 AND id=$2 AND completed_at IS NULL RETURNING id`,[auth.storeId,id,auth.userId]);
      if(!result.rowCount)throw new DomainError(409,'PRINT_UNAVAILABLE','Solicitação já concluída ou indisponível');
      await audit(client,auth,'receipt.print.complete',id);
      return {id,completed:true};
    });
    return out.result;
  });

  app.get('/v1/management/purchases',async(request,reply)=>{
    if(requirePermission(request,reply,'purchase.read'))return reply;
    const result=await db.query(`SELECT p.id,p.quantity,p.unit_cost_cents::text,p.received_at,s.name AS supplier,v.sku
      FROM purchase_orders p JOIN suppliers s ON s.id=p.supplier_id AND s.store_id=p.store_id
      JOIN product_variants v ON v.id=p.variant_id AND v.store_id=p.store_id
      WHERE p.store_id=$1 ORDER BY (p.received_at IS NULL) DESC,p.created_at DESC,p.id LIMIT 100`,
      [request.authContext!.storeId]);
    return {orders:result.rows};
  });

  app.post<{Body:Purchase}>('/v1/management/purchases',{
    schema:{body:{type:'object',additionalProperties:false,required:['supplier_id','variant_id','quantity','unit_cost_cents'],
      properties:{supplier_id:uuid,variant_id:uuid,quantity:{type:'integer',minimum:1,maximum:100000},
        unit_cost_cents:{type:'integer',minimum:0,maximum:100000000}}}},
  },async(request,reply)=>{
    if(requirePermission(request,reply,'purchase.write'))return reply;
    const auth=request.authContext!,body=request.body;
    const out=await withIdempotentTransaction(db,auth,'purchase.create',key(request),body,async client=>{
      const result=await client.query<{id:string}>(`INSERT INTO purchase_orders
        (store_id,supplier_id,variant_id,quantity,unit_cost_cents) VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [auth.storeId,body.supplier_id,body.variant_id,body.quantity,body.unit_cost_cents]);
      await audit(client,auth,'purchase.create',result.rows[0].id);
      return result.rows[0];
    });
    return reply.code(201).send(out.result);
  });

  app.post<{Params:{id:string}}>('/v1/management/purchases/:id/receive',{schema:{params}},async(request,reply)=>{
    if(requirePermission(request,reply,'stock.receive'))return reply;
    const auth=request.authContext!,{id}=request.params;
    const out=await withIdempotentTransaction(db,auth,'purchase.receive:'+id,key(request),{},async client=>{
      const purchase=await client.query<{variant_id:string;quantity:number}>(`UPDATE purchase_orders SET received_at=now()
        WHERE store_id=$1 AND id=$2 AND received_at IS NULL RETURNING variant_id,quantity`,[auth.storeId,id]);
      const line=purchase.rows[0];
      if(!line)throw new DomainError(409,'PURCHASE_UNAVAILABLE','Compra já recebida ou indisponível');
      const balance=await client.query<{revision:string}>(`INSERT INTO stock_balances(store_id,variant_id,on_hand,reserved,revision)
        VALUES($1,$2,$3,0,1) ON CONFLICT(store_id,variant_id) DO UPDATE
        SET on_hand=stock_balances.on_hand+EXCLUDED.on_hand,revision=stock_balances.revision+1 RETURNING revision`,
        [auth.storeId,line.variant_id,line.quantity]);
      await client.query(`INSERT INTO stock_movements(store_id,variant_id,source_type,source_id,movement_kind,qty_delta)
        VALUES($1,$2,'purchase',$3,'receipt',$4)`,[auth.storeId,line.variant_id,id,line.quantity]);
      const revision=balance.rows[0].revision;
      await client.query(`INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload)
        VALUES($1,'inventory.stock.changed.v1',$2,$3,$4::jsonb)`,
        [auth.storeId,line.variant_id,revision,JSON.stringify({variant_id:line.variant_id,revision,purchase_id:id})]);
      await audit(client,auth,'purchase.receive',id);
      return {id,received:true};
    });
    return out.result;
  });

  app.get('/v1/management/pickup-orders',async(request,reply)=>{
    if(requirePermission(request,reply,'storefront.publish'))return reply;
    const result=await db.query(`SELECT id,created_at,quoted_total_cents::text FROM pickup_orders
      WHERE store_id=$1 AND sale_id IS NULL AND cancelled_at IS NULL AND created_at>now()-interval '48 hours'
      ORDER BY created_at,id LIMIT 100`,[request.authContext!.storeId]);
    return {orders:result.rows};
  });

  app.post<{Params:{id:string}}>('/v1/management/pickup-orders/:id/cancel',{schema:{params}},async(request,reply)=>{
    if(requirePermission(request,reply,'storefront.publish'))return reply;
    const auth=request.authContext!,{id}=request.params;
    const out=await withIdempotentTransaction(db,auth,'pickup.cancel:'+id,key(request),{},async client=>{
      const result=await client.query(`UPDATE pickup_orders SET cancelled_at=now()
        WHERE store_id=$1 AND id=$2 AND sale_id IS NULL AND cancelled_at IS NULL
          AND created_at>now()-interval '48 hours' RETURNING id`,[auth.storeId,id]);
      if(!result.rowCount)throw new DomainError(409,'ORDER_UNAVAILABLE','Pedido indisponível para cancelamento');
      await audit(client,auth,'pickup.cancel',id);
      return {id,cancelled:true};
    });
    return out.result;
  });
}
