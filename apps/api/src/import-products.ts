import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { normalizeProductDraft } from '@loja/domain/catalog';
import { requirePermission } from './auth.ts';
import { DomainError, requireIdempotencyKey, withIdempotentTransaction } from './transactions.ts';

type VariantInput = {
  sku:string; color:string; size:string; price_cents:number;
  barcode?:string|null; initial_stock:number; cost_cents?:number|null;
};
type ImportProduct = {name:string;category:string;variants:VariantInput[]};
type ImportBody = {products:ImportProduct[]};

export function registerProductImport(app:FastifyInstance,db:Pool){
  const variantSchema = {
    type:'object',additionalProperties:false,
    required:['sku','color','size','price_cents','initial_stock'],
    properties:{
      sku:{type:'string',minLength:1,maxLength:64},
      color:{type:'string',minLength:1,maxLength:100},
      size:{type:'string',minLength:1,maxLength:32},
      price_cents:{type:'integer',minimum:1,maximum:9999999999},
      cost_cents:{type:['integer','null'],minimum:0,maximum:9999999999},
      barcode:{type:['string','null'],maxLength:128},
      initial_stock:{type:'integer',minimum:0,maximum:1000000}
    }
  };
  app.post<{Body:ImportBody}>('/v1/catalog/products/import',{
    schema:{body:{type:'object',additionalProperties:false,required:['products'],properties:{
      products:{type:'array',minItems:1,maxItems:100,items:{
        type:'object',additionalProperties:false,required:['name','category','variants'],
        properties:{
          name:{type:'string',minLength:1,maxLength:200},
          category:{type:'string',minLength:1,maxLength:100},
          variants:{type:'array',minItems:1,maxItems:200,items:variantSchema}
        }
      }}
    }}}
  },async(request,reply)=>{
    if(requirePermission(request,reply,'catalog.write'))return reply;
    if(request.body.products.some(product=>product.variants.some(v=>v.initial_stock>0)) &&
       !request.authContext!.roles.includes('manager')) {
      const auth=request.authContext!;
      const grant=await db.query('SELECT 1 FROM stock_direct_receive_grants WHERE store_id=$1 AND user_id=$2 AND revoked_at IS NULL',[auth.storeId,auth.userId]);
      if(!grant.rowCount)return reply.code(403).send({code:'FORBIDDEN',message:'Importação com estoque inicial exige autorização para entrada direta'});
    }
    const auth=request.authContext!;
    if(request.body.products.some(p=>p.variants.some(v=>v.initial_stock>0)) &&
      String(request.headers['x-stock-import-reason']??'').trim().length<8)
      throw new DomainError(422,'IMPORT_STOCK_REASON','Informe justificativa no cabeçalho x-stock-import-reason');
    const normalized = request.body.products.map((raw,index)=>{
      try {
        const draft=normalizeProductDraft({name:raw.name,category:raw.category,
          variants:raw.variants.map(({initial_stock:_,cost_cents:__,...variant})=>variant)});
        return {...draft,variants:draft.variants.map((variant,i)=>({
          ...variant,initial_stock:raw.variants[i].initial_stock,cost_cents:raw.variants[i].cost_cents??null
        }))};
      } catch(error) {
        throw new DomainError(422,'INVALID_IMPORT_PRODUCT',
          'Produto '+(index+1)+': '+(error instanceof Error?error.message:'dados inválidos'));
      }
    });
    const totalVariants=normalized.reduce((sum,p)=>sum+p.variants.length,0);
    if(totalVariants>2000)throw new DomainError(422,'IMPORT_TOO_LARGE','Limite de 2.000 variantes por arquivo');
    const skus=new Set<string>(),barcodes=new Set<string>();
    for(const product of normalized)for(const variant of product.variants){
      if(skus.has(variant.sku))throw new DomainError(422,'DUPLICATE_IMPORT_SKU','SKU repetido no arquivo: '+variant.sku);
      skus.add(variant.sku);
      if(variant.barcode){
        if(barcodes.has(variant.barcode))throw new DomainError(422,'DUPLICATE_IMPORT_BARCODE','Código de barras repetido no arquivo');
        barcodes.add(variant.barcode);
      }
    }
    const key=requireIdempotencyKey(request.headers['idempotency-key']);
    const output=await withIdempotentTransaction(db,auth,'catalog.products.import',key,{products:normalized},async client=>{
      if(normalized.some(p=>p.variants.some(v=>v.initial_stock>0))&&!auth.roles.includes('manager')){
        const grant=await client.query('SELECT 1 FROM stock_direct_receive_grants WHERE store_id=$1 AND user_id=$2 AND revoked_at IS NULL FOR UPDATE',[auth.storeId,auth.userId]);
        if(!grant.rowCount)throw new DomainError(403,'DIRECT_RECEIPT_FORBIDDEN','Autorização para estoque inicial revogada');
      }
      const existing=await client.query<{sku:string}>(
        'SELECT sku FROM product_variants WHERE store_id=$1 AND sku=ANY($2::text[]) LIMIT 1',
        [auth.storeId,[...skus]]);
      if(existing.rowCount)throw new DomainError(409,'SKU_ALREADY_EXISTS',
        'SKU já cadastrado na loja: '+existing.rows[0].sku);
      let stockUnits=0;
      for(const product of normalized){
        const created=await client.query<{id:string}>(
          'INSERT INTO products(store_id,name,category) VALUES($1,$2,$3) RETURNING id::text',
          [auth.storeId,product.name,product.category]);
        const productId=created.rows[0].id;
        for(const variant of product.variants){
          const row=await client.query<{id:string}>(
            'INSERT INTO product_variants(store_id,product_id,sku,barcode,color,size,price_cents,cost_cents) '+
            'VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id::text',
            [auth.storeId,productId,variant.sku,variant.barcode,variant.color,variant.size,variant.price_cents,variant.cost_cents]);
          const variantId=row.rows[0].id;
          if(variant.initial_stock>0){
            await client.query(
              "INSERT INTO stock_movements(store_id,variant_id,source_type,source_id,movement_kind,qty_delta) "+
              "VALUES($1,$2,'spreadsheet_import',$3,'receipt',$4)",
              [auth.storeId,variantId,productId,variant.initial_stock]);
            await client.query(
              'INSERT INTO stock_balances(store_id,variant_id,on_hand,reserved,revision) VALUES($1,$2,$3,0,1)',
              [auth.storeId,variantId,variant.initial_stock]);
            await client.query(
              "INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload) "+
              "VALUES($1,'inventory.stock.changed.v1',$2,1,$3::jsonb)",
              [auth.storeId,variantId,JSON.stringify({variant_id:variantId,revision:1})]);
            stockUnits+=variant.initial_stock;
          }
        }
        await client.query(
          "INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload) "+
          "VALUES($1,'catalog.product.created.v1',$2,1,$3::jsonb)",
          [auth.storeId,productId,JSON.stringify({product_id:productId})]);
        await client.query(
          'INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail) VALUES($1,$2,$3,$4,$5::jsonb)',
          [auth.storeId,auth.userId,'catalog.product.import',productId,
            JSON.stringify({variants:product.variants.length,stock_units:product.variants.reduce((a,v)=>a+v.initial_stock,0),reason:String(request.headers['x-stock-import-reason']??'').trim(),source:'spreadsheet_import'})]);
      }
      return {products_created:normalized.length,variants_created:totalVariants,stock_units:stockUnits};
    });
    return reply.code(201).send({...output.result,replayed:output.replayed});
  });
}
