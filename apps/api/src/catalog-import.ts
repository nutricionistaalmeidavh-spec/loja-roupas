import type {FastifyInstance} from 'fastify';
import type {Pool} from 'pg';
import type {ProductDraft} from '@loja/domain/catalog';
import {normalizeProductDraft} from '@loja/domain/catalog';
import {requirePermission} from './auth.ts';
import {DomainError,requireIdempotencyKey,withIdempotentTransaction} from './transactions.ts';

type Row={name:string;category:string;sku:string;color:string;size:string;price_cents:number;barcode?:string|null;initial_stock?:number};
type ImportBody={rows:Row[]};
export function normalizeImportRows(rows:Row[]){
 const groups=new Map<string,{draft:ProductDraft;stocks:number[]}>();
 const allSku=new Set<string>(),allBarcode=new Set<string>();
 let units=0;
 for(const raw of rows){
  const stock=raw.initial_stock??0;
  if(!Number.isSafeInteger(stock)||stock<0||stock>100000)
   throw new DomainError(422,'IMPORT_INVALID','Estoque inicial inválido');
  let normalized:ProductDraft;
  try{normalized=normalizeProductDraft({
   name:raw.name,category:raw.category,
   variants:[{sku:raw.sku,color:raw.color,size:raw.size,price_cents:raw.price_cents,barcode:raw.barcode}]
  });}catch(err){throw new DomainError(422,'IMPORT_INVALID',err instanceof Error?err.message:'Linha inválida');}
  const sku=normalized.variants[0].sku,barcode=normalized.variants[0].barcode;
  if(allSku.has(sku)||(barcode&&allBarcode.has(barcode)))
   throw new DomainError(422,'IMPORT_DUPLICATE','SKU ou código de barras repetido na planilha');
  allSku.add(sku);if(barcode)allBarcode.add(barcode);
  const key=normalized.name.toLocaleLowerCase('pt-BR')+'\0'+normalized.category.toLocaleLowerCase('pt-BR');
  let group=groups.get(key);
  if(!group){group={draft:{name:normalized.name,category:normalized.category,variants:[]},stocks:[]};groups.set(key,group);}
  group.draft.variants.push(normalized.variants[0]);group.stocks.push(stock);units+=stock;
 }
 for(const group of groups.values()){
  try{group.draft=normalizeProductDraft(group.draft);}
  catch(err){throw new DomainError(422,'IMPORT_INVALID',err instanceof Error?err.message:'Grade inválida');}
 }
 return {groups:[...groups.values()],units};
}

export function registerCatalogImport(app:FastifyInstance,db:Pool){
 app.post<{Body:ImportBody}>('/v1/catalog/imports',{
  schema:{body:{type:'object',additionalProperties:false,required:['rows'],properties:{
   rows:{type:'array',minItems:1,maxItems:300,items:{type:'object',additionalProperties:false,
    required:['name','category','sku','color','size','price_cents'],
    properties:{
     name:{type:'string',minLength:1,maxLength:200},category:{type:'string',minLength:1,maxLength:100},
     sku:{type:'string',minLength:1,maxLength:64},color:{type:'string',minLength:1,maxLength:100},
     size:{type:'string',minLength:1,maxLength:32},price_cents:{type:'integer',minimum:0,maximum:2000000000},
     barcode:{type:['string','null'],maxLength:128},initial_stock:{type:'integer',minimum:0,maximum:100000}
    }
   }}
  }}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'catalog.write'))return reply;
  const {groups,units}=normalizeImportRows(request.body.rows);
  if(units>0&&requirePermission(request,reply,'stock.receive'))return reply;
  const key=requireIdempotencyKey(request.headers['idempotency-key']);
  const auth=request.authContext!;
  const payload=groups.map(g=>({product:g.draft,stocks:g.stocks}));
  const result=await withIdempotentTransaction(db,auth,'catalog.bulk.import',key,payload,async client=>{
   const ids:string[]=[];let variants=0;
   for(const group of groups){
    const product=await client.query<{id:string}>(
     'INSERT INTO products(store_id,name,category) VALUES($1,$2,$3) RETURNING id::text',
     [auth.storeId,group.draft.name,group.draft.category]);
    const productId=product.rows[0].id;ids.push(productId);
    for(let i=0;i<group.draft.variants.length;i++){
     const v=group.draft.variants[i],stock=group.stocks[i];
     const inserted=await client.query<{id:string}>(
      'INSERT INTO product_variants (store_id,product_id,sku,barcode,color,size,price_cents) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id::text',
      [auth.storeId,productId,v.sku,v.barcode,v.color,v.size,v.price_cents]);
     const variantId=inserted.rows[0].id;variants++;
     if(stock>0){
      await client.query("INSERT INTO stock_movements (store_id,variant_id,source_type,source_id,movement_kind,qty_delta) VALUES($1,$2,'manual_receipt',$3,'receipt',$4)",
       [auth.storeId,variantId,variantId,stock]);
      await client.query('INSERT INTO stock_balances (store_id,variant_id,on_hand,reserved,revision) VALUES($1,$2,$3,0,1)',
       [auth.storeId,variantId,stock]);
      await client.query("INSERT INTO outbox_events (store_id,event_type,aggregate_id,aggregate_revision,payload) VALUES($1,'inventory.stock.changed.v1',$2,1,$3::jsonb)",
       [auth.storeId,variantId,JSON.stringify({variant_id:variantId,revision:1})]);
      await client.query("INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail) VALUES($1,$2,'inventory.receipt',$3,$4::jsonb)",
       [auth.storeId,auth.userId,variantId,JSON.stringify({source:'spreadsheet',quantity:stock})]);
     }
    }
    await client.query("INSERT INTO outbox_events (store_id,event_type,aggregate_id,aggregate_revision,payload) VALUES($1,'catalog.product.created.v1',$2,1,$3::jsonb)",
     [auth.storeId,productId,JSON.stringify({product_id:productId})]);
    await client.query("INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail) VALUES($1,$2,'catalog.product.import',$3,$4::jsonb)",
     [auth.storeId,auth.userId,productId,JSON.stringify({variants:group.draft.variants.length})]);
   }
   return {products_created:ids.length,variants_created:variants,stock_units_received:units,product_ids:ids};
  });
  return reply.code(201).send(result.result);
 });
}
