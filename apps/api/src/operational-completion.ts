import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import {purchaseState,transition} from '@loja/domain/operations';
import type {PurchaseReceiptRequest} from '@loja/domain/operations';
import type { AuthContext } from './auth.ts';
import { requirePermission } from './auth.ts';
import { releasePickupReservation } from './reservations.ts';
import { DomainError, requireIdempotencyKey, withIdempotentTransaction } from './transactions.ts';

const uuid = {type:'string',pattern:'^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'};
const params = {type:'object',required:['id'],properties:{id:uuid}};
const key = (request:FastifyRequest) => requireIdempotencyKey(request.headers['idempotency-key']);
type Purchase = {supplier_id:string;variant_id:string;quantity:number;unit_cost_cents:number;promised_on?:string};

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
    const result=await db.query(`SELECT p.id,p.quantity,p.unit_cost_cents::text,p.received_at,p.promised_on::text,p.accepted_quantity,p.received_quantity,p.rejected_quantity,p.missing_quantity,p.quality_finalized,s.name AS supplier,v.sku
      FROM purchase_orders p JOIN suppliers s ON s.id=p.supplier_id AND s.store_id=p.store_id
      JOIN product_variants v ON v.id=p.variant_id AND v.store_id=p.store_id
      WHERE p.store_id=$1 ORDER BY (p.received_at IS NULL) DESC,p.created_at DESC,p.id LIMIT 100`,
      [request.authContext!.storeId]);
    return {orders:result.rows};
  });

  app.post<{Body:Purchase}>('/v1/management/purchases',{
    schema:{body:{type:'object',additionalProperties:false,required:['supplier_id','variant_id','quantity','unit_cost_cents'],
      properties:{supplier_id:uuid,variant_id:uuid,quantity:{type:'integer',minimum:1,maximum:100000},
        unit_cost_cents:{type:'integer',minimum:0,maximum:100000000},
        promised_on:{type:'string',format:'date'}}}},
  },async(request,reply)=>{
    if(requirePermission(request,reply,'purchase.write'))return reply;
    const auth=request.authContext!,body=request.body;
    const out=await withIdempotentTransaction(db,auth,'purchase.create',key(request),body,async client=>{
      const result=await client.query<{id:string}>(`INSERT INTO purchase_orders
        (store_id,supplier_id,variant_id,quantity,unit_cost_cents,promised_on) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [auth.storeId,body.supplier_id,body.variant_id,body.quantity,body.unit_cost_cents,body.promised_on??null]);
      await audit(client,auth,'purchase.create',result.rows[0].id);
      return result.rows[0];
    });
    return reply.code(201).send(out.result);
  });

  app.post<{Params:{id:string};Body:PurchaseReceiptRequest}>(
  '/v1/management/purchases/:id/receive',{
    schema:{params,body:{type:'object',additionalProperties:false,
      required:['received_quantity','accepted_quantity'],properties:{
        received_quantity:{type:'integer',minimum:1,maximum:100000},
        accepted_quantity:{type:'integer',minimum:0,maximum:100000},
        reason:{type:'string',maxLength:250}
      }}}
  },async(request,reply)=>{
    if(requirePermission(request,reply,'stock.receive'))return reply;
    const auth=request.authContext!,{id}=request.params;
    const {received_quantity,accepted_quantity}=request.body;
    const reason=request.body.reason?.trim()??'';
    const out=await withIdempotentTransaction(db,auth,'purchase.receive:'+id,key(request),request.body,async client=>{
      const purchase=await client.query<{variant_id:string;quantity:number;received_at:Date|null;quality_finalized:boolean}>(`SELECT variant_id,quantity,received_at,quality_finalized
        FROM purchase_orders WHERE store_id=$1 AND id=$2 FOR UPDATE`,[auth.storeId,id]);
      const line=purchase.rows[0];
      if(!line||transition('purchase',purchaseState({received_at:line.received_at?.toISOString()??null,
        quality_finalized:line.quality_finalized}),'receive')!=='checked')
        throw new DomainError(409,'PURCHASE_UNAVAILABLE','Compra já recebida ou indisponível');
      if(received_quantity>line.quantity||accepted_quantity>received_quantity)
        throw new DomainError(422,'RECEIPT_QUANTITY','Aprovadas não podem exceder recebidas ou pedidas');
      const rejected_quantity=received_quantity-accepted_quantity;
      const missing_quantity=line.quantity-received_quantity;
      if((rejected_quantity>0||missing_quantity>0)&&reason.length<8)
        throw new DomainError(422,'RECEIPT_REASON','Justifique avarias ou divergências com ao menos 8 caracteres');
      await client.query(`UPDATE purchase_orders SET received_at=now(),quality_finalized=true,
        received_quantity=$3,accepted_quantity=$4,rejected_quantity=$5,missing_quantity=$6
        WHERE store_id=$1 AND id=$2`,
        [auth.storeId,id,received_quantity,accepted_quantity,rejected_quantity,missing_quantity]);
      if(accepted_quantity>0) {
        const balance=await client.query<{revision:string}>(`INSERT INTO stock_balances(store_id,variant_id,on_hand,reserved,revision)
          VALUES($1,$2,$3,0,1) ON CONFLICT(store_id,variant_id) DO UPDATE
          SET on_hand=stock_balances.on_hand+EXCLUDED.on_hand,revision=stock_balances.revision+1 RETURNING revision`,
          [auth.storeId,line.variant_id,accepted_quantity]);
        await client.query(`INSERT INTO stock_movements(store_id,variant_id,source_type,source_id,movement_kind,qty_delta)
          VALUES($1,$2,'purchase',$3,'receipt',$4)`,[auth.storeId,line.variant_id,id,accepted_quantity]);
        const revision=balance.rows[0].revision;
        await client.query(`INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload)
          VALUES($1,'inventory.stock.changed.v1',$2,$3,$4::jsonb)`,
          [auth.storeId,line.variant_id,revision,JSON.stringify({variant_id:line.variant_id,revision,purchase_id:id})]);
      }
      await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
        VALUES($1,$2,'purchase.receive',$3,$4::jsonb)`,
        [auth.storeId,auth.userId,id,JSON.stringify({received_quantity,accepted_quantity,rejected_quantity,missing_quantity,reason})]);
      return {id,received:true,received_quantity,accepted_quantity,rejected_quantity,missing_quantity};
    });
    return out.result;
  });

  // Qualidade é finalizada na conferência, na mesma transação que libera apenas peças aprovadas.
  // O endpoint legado não pode reescrever a classificação sem movimentação compensatória.
  app.put<{Params:{id:string};Body:{accepted_quantity:number}}>('/v1/management/purchases/:id/quality',{
    schema:{params,body:{type:'object',additionalProperties:false,required:['accepted_quantity'],
      properties:{accepted_quantity:{type:'integer',minimum:0,maximum:100000}}}},
  },async(request,reply)=>{
    if(requirePermission(request,reply,'purchase.write'))return reply;
    throw new DomainError(409,'QUALITY_IMMUTABLE','Conferência concluída. Use ajuste auditado de estoque para reclassificar peças.');
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
      await releasePickupReservation(client,auth.storeId,id,'cancelled');
      await audit(client,auth,'pickup.cancel',id);
      return {id,cancelled:true};
    });
    return out.result;
  });
}
