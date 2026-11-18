import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { ProductDraft } from '@loja/domain/catalog';
import { normalizeProductDraft, validateReceiptQuantity } from '@loja/domain/catalog';
import { requirePermission } from './auth.ts';
import { DomainError, requireIdempotencyKey, withIdempotentTransaction } from './transactions.ts';

type ProductRecord = { id:string; name:string; category:string; variants:Array<{id:string;product_id:string;sku:string;color:string;size:string;price_cents:number;barcode:string|null;available:number;revision:number}> };
type ReceiptInput = { variant_id:string; reference_id:string; quantity:number; note?:string };
const uuid = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';

export function registerMutations(app: FastifyInstance, db: Pool) {
  app.post<{Body:ProductDraft}>('/v1/catalog/products',{
    schema:{body:{
      type:'object',additionalProperties:false,required:['name','category','variants'],
      properties:{
        name:{type:'string',minLength:1,maxLength:200},
        category:{type:'string',minLength:1,maxLength:100},
        variants:{type:'array',minItems:1,maxItems:200,items:{
          type:'object',additionalProperties:false,required:['sku','color','size','price_cents'],
          properties:{
            sku:{type:'string',minLength:1,maxLength:64},
            color:{type:'string',minLength:1,maxLength:100},
            size:{type:'string',minLength:1,maxLength:32},
            price_cents:{type:'integer',minimum:0},
            barcode:{type:['string','null'],maxLength:128}
          }
        }}
      }
    }}
  },async(request,reply)=>{
    if(requirePermission(request,reply,'catalog.write'))return reply;
    let input:ProductDraft;
    try{input=normalizeProductDraft(request.body);}catch(error){
      throw new DomainError(422,'PRODUCT_INVALID',error instanceof Error?error.message:'Produto inválido');
    }
    const key=requireIdempotencyKey(request.headers['idempotency-key']);
    const auth=request.authContext!;
    const response=await withIdempotentTransaction(db,auth,'catalog.product.create',key,input,async client=>{
      const created=await client.query<{id:string}>(
        'INSERT INTO products(store_id,name,category) VALUES($1,$2,$3) RETURNING id::text',
        [auth.storeId,input.name,input.category]);
      const productId=created.rows[0].id;
      const variants:ProductRecord['variants']=[];
      for(const variant of input.variants){
        const row=await client.query<{id:string}>(`INSERT INTO product_variants
          (store_id,product_id,sku,barcode,color,size,price_cents)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id::text`,
          [auth.storeId,productId,variant.sku,variant.barcode,variant.color,variant.size,variant.price_cents]);
        variants.push({...variant,id:row.rows[0].id,product_id:productId,barcode:variant.barcode??null,available:0,revision:0});
      }
      await client.query(`INSERT INTO outbox_events
        (store_id,event_type,aggregate_id,aggregate_revision,payload)
        VALUES($1,'catalog.product.created.v1',$2,1,$3::jsonb)`,
        [auth.storeId,productId,JSON.stringify({product_id:productId})]);
      await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
        VALUES($1,$2,'catalog.product.create',$3,$4::jsonb)`,
        [auth.storeId,auth.userId,productId,JSON.stringify({variants:variants.length})]);
      return {id:productId,name:input.name,category:input.category,variants};
    });
    return reply.code(201).send(response.result);
  });

  app.post<{Body:ReceiptInput}>('/v1/stock/receipts',{
    schema:{body:{
      type:'object',additionalProperties:false,required:['variant_id','reference_id','quantity'],
      properties:{
        variant_id:{type:'string',pattern:uuid},
        reference_id:{type:'string',pattern:uuid},
        quantity:{type:'integer',minimum:1},
        note:{type:'string',maxLength:140}
      }
    }}
  },async(request,reply)=>{
    if(requirePermission(request,reply,'stock.receive'))return reply;
    const key=requireIdempotencyKey(request.headers['idempotency-key']);
    const input={...request.body,quantity:validateReceiptQuantity(request.body.quantity)};
    const auth=request.authContext!;
    const response=await withIdempotentTransaction(db,auth,'stock.receipt.create',key,input,async client=>{
      const variant=await client.query<{id:string}>(`SELECT id::text FROM product_variants WHERE id=$1 AND store_id=$2 FOR KEY SHARE`,
        [input.variant_id,auth.storeId]);
      if(!variant.rowCount)throw new DomainError(404,'VARIANT_NOT_FOUND','Variante não encontrada na loja');
      const movement=await client.query<{id:string}>(`INSERT INTO stock_movements
        (store_id,variant_id,source_type,source_id,movement_kind,qty_delta)
        VALUES ($1,$2,'manual_receipt',$3,'receipt',$4)
        ON CONFLICT (store_id,source_type,source_id,variant_id,movement_kind) DO NOTHING
        RETURNING id::text`,[auth.storeId,input.variant_id,input.reference_id,input.quantity]);
      if(!movement.rowCount)throw new DomainError(409,'RECEIPT_ALREADY_RECORDED','Entrada já registrada');
      const balance=await client.query<{on_hand:string;reserved:string;revision:string}>(`INSERT INTO stock_balances
        (store_id,variant_id,on_hand,reserved,revision)
        VALUES($1,$2,$3,0,1)
        ON CONFLICT (store_id,variant_id) DO UPDATE SET
          on_hand=stock_balances.on_hand+EXCLUDED.on_hand,
          revision=stock_balances.revision+1
        RETURNING on_hand::text,reserved::text,revision::text`,
        [auth.storeId,input.variant_id,input.quantity]);
      const stock=balance.rows[0];
      await client.query(`INSERT INTO outbox_events
        (store_id,event_type,aggregate_id,aggregate_revision,payload)
        VALUES($1,'inventory.stock.changed.v1',$2,$3,$4::jsonb)`,
        [auth.storeId,input.variant_id,stock.revision,JSON.stringify({variant_id:input.variant_id,revision:stock.revision})]);
      await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
        VALUES($1,$2,'inventory.receipt',$3,$4::jsonb)`,
        [auth.storeId,auth.userId,input.variant_id,JSON.stringify({reference_id:input.reference_id,quantity:input.quantity})]);
      return { movement_id:movement.rows[0].id, variant_id:input.variant_id,
        on_hand:Number(stock.on_hand),reserved:Number(stock.reserved),revision:Number(stock.revision) };
    });
    return reply.code(201).send(response.result);
  });
}
