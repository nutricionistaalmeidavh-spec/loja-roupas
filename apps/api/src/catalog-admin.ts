import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { requirePermission } from './auth.ts';
import { DomainError,requireIdempotencyKey,withIdempotentTransaction } from './transactions.ts';

type ProductPatch={name:string;category:string;expected_revision:number};
type PricePatch={price_cents:number;expected_revision:number};
type Adjustment={variant_id:string;reference_id:string;counted_on_hand:number;expected_revision:number;reason:string};
const uid='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
const uuidParams={type:'object',required:['id'],properties:{id:{type:'string',pattern:uid}}} as const;
const keyOf=(v:unknown)=>requireIdempotencyKey(v);
const contentTypes=new Set(['image/png','image/jpeg','image/webp']);
function validateImage(bytes:Buffer, type:string) {
 const png=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
 const jpg=bytes.length>3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
 const webp=bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(bytes.length<16||bytes.length>2097152||!contentTypes.has(type)||
   !(type==='image/png'&&png||type==='image/jpeg'&&jpg||type==='image/webp'&&webp))
   throw new DomainError(415,'INVALID_IMAGE','Imagem inválida. Use PNG, JPEG ou WebP de até 2 MiB.');
}
export function registerCatalogAdmin(app:FastifyInstance,db:Pool) {
 app.addContentTypeParser(/^image\/(png|jpeg|webp)$/,{
   parseAs:'buffer',bodyLimit:2097152
 },(_request,body,done)=>done(null,body));
 app.patch<{Params:{id:string};Body:ProductPatch}>('/v1/catalog/products/:id',{
  schema:{params:uuidParams,body:{type:'object',additionalProperties:false,required:['name','category','expected_revision'],
    properties:{name:{type:'string',minLength:1,maxLength:200},category:{type:'string',minLength:1,maxLength:100},
      expected_revision:{type:'integer',minimum:1}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'catalog.write'))return reply;
  const auth=request.authContext!,body={...request.body,name:request.body.name.trim(),category:request.body.category.trim()};
  if(!body.name||!body.category)throw new DomainError(422,'BAD_PRODUCT','Informe nome e categoria');
  const key=keyOf(request.headers['idempotency-key']);
  const result=await withIdempotentTransaction(db,auth,'catalog.product.patch:'+request.params.id,key,body,async client=>{
    const updated=await client.query<{id:string;revision:string}>(`UPDATE products SET name=$3,category=$4,revision=revision+1
      WHERE id=$1 AND store_id=$2 AND revision=$5 RETURNING id::text,revision::text`,
      [request.params.id,auth.storeId,body.name,body.category,body.expected_revision]);
    if(!updated.rowCount)throw new DomainError(409,'REVISION_CONFLICT','Produto inexistente ou editado por outro operador');
    const revision=Number(updated.rows[0].revision);
    await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
      VALUES($1,$2,'catalog.product.patch',$3,$4::jsonb)`,[auth.storeId,auth.userId,request.params.id,JSON.stringify({revision})]);
    await client.query(`INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload)
      VALUES($1,'catalog.product.updated.v1',$2,$3,$4::jsonb)`,[auth.storeId,request.params.id,revision,JSON.stringify({revision})]);
    return {id:request.params.id,name:body.name,category:body.category,revision};
  });
  return result.result;
 });
 app.patch<{Params:{id:string};Body:PricePatch}>('/v1/catalog/variants/:id',{
  schema:{params:uuidParams,body:{type:'object',additionalProperties:false,required:['price_cents','expected_revision'],
   properties:{price_cents:{type:'integer',minimum:0},expected_revision:{type:'integer',minimum:1}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'pricing.write'))return reply;
  const auth=request.authContext!,key=keyOf(request.headers['idempotency-key']);
  const result=await withIdempotentTransaction(db,auth,'catalog.variant.price:'+request.params.id,key,request.body,async client=>{
   const updated=await client.query<{id:string;revision:string}>(`UPDATE product_variants SET price_cents=$3,revision=revision+1
     WHERE id=$1 AND store_id=$2 AND revision=$4 RETURNING id::text,revision::text`,
      [request.params.id,auth.storeId,request.body.price_cents,request.body.expected_revision]);
   if(!updated.rowCount)throw new DomainError(409,'REVISION_CONFLICT','Variante inexistente ou preço desatualizado');
   const rev=Number(updated.rows[0].revision);
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail) VALUES($1,$2,'pricing.variant.update',$3,$4::jsonb)`,
      [auth.storeId,auth.userId,request.params.id,JSON.stringify({revision:rev,price_cents:request.body.price_cents})]);
   await client.query(`INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload)
     VALUES($1,'pricing.variant.changed.v1',$2,$3,$4::jsonb)`,[auth.storeId,request.params.id,rev,JSON.stringify({price_cents:request.body.price_cents})]);
   return {id:request.params.id,price_cents:request.body.price_cents,revision:rev};
  });
  return result.result;
 });
 app.put<{Params:{id:string};Body:Buffer}>('/v1/catalog/products/:id/photo',{
  schema:{params:uuidParams}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'catalog.write'))return reply;
  const type=String(request.headers['content-type']??'').split(';')[0].trim().toLowerCase();
  const bytes=request.body;
  if(!Buffer.isBuffer(bytes))throw new DomainError(415,'INVALID_IMAGE','Imagem binária obrigatória');
  validateImage(bytes,type);
  const auth=request.authContext!,key=keyOf(request.headers['idempotency-key']);
  const sha256=createHash('sha256').update(bytes).digest('hex');
  let thumbnail:Buffer;
  try{
    const image=sharp(bytes,{limitInputPixels:16_000_000,failOn:'error'});
    const metadata=await image.metadata();
    const expected=type==='image/png'?'png':type==='image/jpeg'?'jpeg':'webp';
    if(metadata.format!==expected)throw new Error('Formato real diferente do indicado');
    thumbnail=await sharp(bytes,{limitInputPixels:16_000_000,failOn:'error'})
      .rotate().resize({width:480,height:640,fit:'inside',withoutEnlargement:true}).webp({quality:68}).toBuffer();
    if(thumbnail.length>524288)throw new Error('Miniatura acima do limite');
  }catch{
    throw new DomainError(415,'INVALID_IMAGE','Imagem não pode ser decodificada ou excede limite de resolução');
  }
  const response=await withIdempotentTransaction(db,auth,'catalog.photo:'+request.params.id,key,{sha256,type},async client=>{
   const exists=await client.query('SELECT id FROM products WHERE id=$1 AND store_id=$2 FOR KEY SHARE',
     [request.params.id,auth.storeId]);
   if(!exists.rowCount)throw new DomainError(404,'NOT_FOUND','Produto não encontrado');
   await client.query(`INSERT INTO product_photos(product_id,store_id,content_type,image_bytes,sha256,thumb_bytes,thumb_type)
    VALUES($1,$2,$3,$4,$5,$6,'image/webp') ON CONFLICT(product_id,store_id) DO UPDATE SET
    content_type=EXCLUDED.content_type,image_bytes=EXCLUDED.image_bytes,sha256=EXCLUDED.sha256,
    thumb_bytes=EXCLUDED.thumb_bytes,thumb_type=EXCLUDED.thumb_type,updated_at=now()`,
    [request.params.id,auth.storeId,type,bytes,sha256,thumbnail]);
   const rev=await client.query<{revision:string}>(
    'UPDATE products SET revision=revision+1 WHERE store_id=$1 AND id=$2 RETURNING revision::text',
    [auth.storeId,request.params.id]);
   const revision=Number(rev.rows[0].revision);
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail) VALUES
     ($1,$2,'catalog.photo.update',$3,$4::jsonb)`,[auth.storeId,auth.userId,request.params.id,JSON.stringify({sha256,type,revision})]);
   await client.query(`INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload)
     VALUES($1,'catalog.product.updated.v1',$2,$3,$4::jsonb)`,
     [auth.storeId,request.params.id,revision,JSON.stringify({revision,media:true})]);
   return {product_id:request.params.id,sha256,content_type:type,revision};
  });
  return response.result;
 });
 app.get<{Params:{id:string}}>('/v1/catalog/products/:id/photo',{schema:{params:uuidParams}},async(request,reply)=>{
  if(requirePermission(request,reply,'catalog.read'))return reply;
  const image=await db.query<{content_type:string;image_bytes:Buffer}>(`SELECT content_type,image_bytes FROM product_photos
    WHERE product_id=$1 AND store_id=$2`,[request.params.id,request.authContext!.storeId]);
  if(!image.rowCount)throw new DomainError(404,'NO_IMAGE','Produto sem fotografia');
  return reply.header('cache-control','private, no-store').header('x-content-type-options','nosniff')
    .type(image.rows[0].content_type).send(image.rows[0].image_bytes);
 });
 app.post<{Body:Adjustment}>('/v1/stock/adjustments',{
   schema:{body:{type:'object',additionalProperties:false,required:['variant_id','reference_id','counted_on_hand','expected_revision','reason'],
    properties:{variant_id:{type:'string',pattern:uid},reference_id:{type:'string',pattern:uid},
      counted_on_hand:{type:'integer',minimum:0},expected_revision:{type:'integer',minimum:1},
      reason:{type:'string',minLength:8,maxLength:250}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'stock.adjust'))return reply;
  const auth=request.authContext!,input=request.body,key=keyOf(request.headers['idempotency-key']);
  const result=await withIdempotentTransaction(db,auth,'stock.adjustment',key,input,async client=>{
    const state=await client.query<{on_hand:string;reserved:string;revision:string}>(`SELECT on_hand::text,reserved::text,revision::text
      FROM stock_balances WHERE store_id=$1 AND variant_id=$2 FOR UPDATE`,[auth.storeId,input.variant_id]);
    if(!state.rowCount)throw new DomainError(404,'NO_STOCK','Variante sem movimentação anterior');
    const old=state.rows[0],current=Number(old.on_hand),reserved=Number(old.reserved),revision=Number(old.revision);
    if(revision!==input.expected_revision)throw new DomainError(409,'REVISION_CONFLICT','Saldo mudou durante contagem');
    if(input.counted_on_hand<reserved)throw new DomainError(409,'BELOW_RESERVED','Ajuste menor que estoque reservado');
    const delta=input.counted_on_hand-current;
    if(delta===0)throw new DomainError(422,'NO_CHANGE','Quantidade igual ao saldo; não há ajuste');
    const movement=await client.query<{id:string}>(`INSERT INTO stock_movements(store_id,variant_id,source_type,source_id,movement_kind,qty_delta)
      VALUES($1,$2,'manager_adjustment',$3,'adjustment',$4)
      ON CONFLICT(store_id,source_type,source_id,variant_id,movement_kind) DO NOTHING
      RETURNING id::text`,[auth.storeId,input.variant_id,input.reference_id,delta]);
    if(!movement.rowCount)throw new DomainError(409,'ALREADY_ADJUSTED','Referência de ajuste já utilizada');
    const updated=await client.query<{revision:string}>(`UPDATE stock_balances SET on_hand=$3,revision=revision+1
      WHERE store_id=$1 AND variant_id=$2 RETURNING revision::text`,[auth.storeId,input.variant_id,input.counted_on_hand]);
    const rev=Number(updated.rows[0].revision);
    await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
      VALUES($1,$2,'inventory.adjustment',$3,$4::jsonb)`,[auth.storeId,auth.userId,input.variant_id,
      JSON.stringify({reference_id:input.reference_id,delta,reason:input.reason,revision:rev})]);
    await client.query(`INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload)
      VALUES($1,'inventory.stock.changed.v1',$2,$3,$4::jsonb)`,[auth.storeId,input.variant_id,rev,JSON.stringify({revision:rev})]);
    return {movement_id:movement.rows[0].id,variant_id:input.variant_id,on_hand:input.counted_on_hand,reserved,revision:rev};
  });
  return reply.code(201).send(result.result);
 });
 app.get<{Querystring:{variant_id:string;limit?:number}}>('/v1/stock/movements',{
   schema:{querystring:{type:'object',additionalProperties:false,required:['variant_id'],
     properties:{variant_id:{type:'string',pattern:uid},limit:{type:'integer',minimum:1,maximum:100,default:50}}}}
 },async(request,reply)=>{
   if(requirePermission(request,reply,'stock.read'))return reply;
   const rows=await db.query<{id:string;movement_kind:string;qty_delta:string;occurred_at:Date;source_type:string}>(`SELECT id::text,movement_kind,qty_delta::text,occurred_at,source_type
     FROM stock_movements WHERE store_id=$1 AND variant_id=$2 ORDER BY occurred_at DESC,id DESC LIMIT $3`,
    [request.authContext!.storeId,request.query.variant_id,request.query.limit??50]);
   return {items:rows.rows.map(r=>({...r,qty_delta:Number(r.qty_delta)}))};
 });
 app.get<{Params:{id:string};Querystring:{v?:string}}>('/v1/catalog/products/:id/thumbnail',{
  schema:{params:uuidParams,querystring:{type:'object',additionalProperties:false,
   properties:{v:{type:'string',pattern:'^[a-f0-9]{64}$'}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'catalog.read'))return reply;
  const row=await db.query<{bytes:Buffer;mime:string;sha256:string}>(`SELECT
   sha256,COALESCE(thumb_bytes,image_bytes) AS bytes,
   CASE WHEN thumb_bytes IS NOT NULL THEN thumb_type ELSE content_type END AS mime
   FROM product_photos WHERE product_id=$1 AND store_id=$2`,
   [request.params.id,request.authContext!.storeId]);
  if(!row.rowCount)throw new DomainError(404,'NO_IMAGE','Produto sem fotografia');
  const data=row.rows[0];
  if(request.query.v&&request.query.v!==data.sha256)
   throw new DomainError(409,'PHOTO_CHANGED','Fotografia atualizada; recarregue o catálogo');
  const etag='"'+data.sha256+'"';
  reply.header('etag',etag)
   .header('cache-control',request.query.v?'private, max-age=300, must-revalidate':'private, no-store')
   .header('vary','Authorization, x-store-id')
   .header('x-content-type-options','nosniff');
  if(request.headers['if-none-match']===etag)return reply.code(304).send();
  return reply.type(data.mime).send(data.bytes);
 });
 app.post<{Params:{id:string};Body:{sku:string;color:string;size:string;price_cents:number;barcode?:string|null;expected_product_revision:number}}>(
 '/v1/catalog/products/:id/variants',{
  schema:{params:uuidParams,body:{type:'object',additionalProperties:false,
   required:['sku','color','size','price_cents','expected_product_revision'],properties:{
    sku:{type:'string',minLength:1,maxLength:64},color:{type:'string',minLength:1,maxLength:100},
    size:{type:'string',minLength:1,maxLength:32},price_cents:{type:'integer',minimum:0},
    barcode:{type:['string','null'],maxLength:128},expected_product_revision:{type:'integer',minimum:1}
   }}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'catalog.write'))return reply;
  const auth=request.authContext!,body=request.body;
  const sku=body.sku.trim().toUpperCase(),color=body.color.trim(),size=body.size.trim();
  if(!/^[A-Z0-9_-]{1,64}$/.test(sku)||!color||!size)
   throw new DomainError(422,'INVALID_VARIANT','SKU, cor ou tamanho inválidos');
  const input={sku,color,size,price_cents:body.price_cents,
   barcode:body.barcode?.trim()||null,expected_product_revision:body.expected_product_revision};
  const key=requireIdempotencyKey(request.headers['idempotency-key']);
  const out=await withIdempotentTransaction(db,auth,'catalog.variant.add:'+request.params.id,key,input,async client=>{
   const product=await client.query<{revision:string}>(`UPDATE products SET revision=revision+1
     WHERE id=$1 AND store_id=$2 AND revision=$3 RETURNING revision::text`,
     [request.params.id,auth.storeId,input.expected_product_revision]);
   if(!product.rowCount)throw new DomainError(409,'REVISION_CONFLICT','Produto alterado por outro operador');
   const variant=await client.query<{id:string}>(`INSERT INTO product_variants
    (store_id,product_id,sku,barcode,color,size,price_cents)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id::text`,
    [auth.storeId,request.params.id,sku,input.barcode,color,size,input.price_cents]);
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
    VALUES($1,$2,'catalog.variant.add',$3,$4::jsonb)`,
    [auth.storeId,auth.userId,variant.rows[0].id,JSON.stringify({product_id:request.params.id,sku})]);
   await client.query(`INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload)
    VALUES($1,'catalog.variant.created.v1',$2,1,$3::jsonb)`,
    [auth.storeId,variant.rows[0].id,JSON.stringify({product_id:request.params.id})]);
   return {id:variant.rows[0].id,product_id:request.params.id,revision:1,...input};
  });
  return reply.code(201).send(out.result);
 });
 app.patch<{Params:{id:string};Body:{sku:string;color:string;size:string;barcode?:string|null;expected_revision:number}}>(
 '/v1/catalog/variants/:id/attributes',{
  schema:{params:uuidParams,body:{type:'object',additionalProperties:false,
   required:['sku','color','size','expected_revision'],properties:{
    sku:{type:'string',minLength:1,maxLength:64},color:{type:'string',minLength:1,maxLength:100},
    size:{type:'string',minLength:1,maxLength:32},barcode:{type:['string','null'],maxLength:128},
    expected_revision:{type:'integer',minimum:1}
   }}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'catalog.write'))return reply;
  const auth=request.authContext!,raw=request.body;
  const normalized={sku:raw.sku.trim().toUpperCase(),color:raw.color.trim(),size:raw.size.trim(),
   barcode:raw.barcode?.trim()||null,expected_revision:raw.expected_revision};
  if(!/^[A-Z0-9_-]{1,64}$/.test(normalized.sku)||!normalized.color||!normalized.size)
   throw new DomainError(422,'INVALID_VARIANT','SKU, cor ou tamanho inválidos');
  const key=requireIdempotencyKey(request.headers['idempotency-key']);
  const out=await withIdempotentTransaction(db,auth,'catalog.variant.attributes:'+request.params.id,key,normalized,async client=>{
   const changed=await client.query<{revision:string}>(`UPDATE product_variants SET
    sku=$3,color=$4,size=$5,barcode=$6,revision=revision+1
    WHERE id=$1 AND store_id=$2 AND revision=$7 RETURNING revision::text`,
    [request.params.id,auth.storeId,normalized.sku,normalized.color,normalized.size,
     normalized.barcode,normalized.expected_revision]);
   if(!changed.rowCount)throw new DomainError(409,'REVISION_CONFLICT','Variante alterada por outro operador');
   const rev=Number(changed.rows[0].revision);
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
    VALUES($1,$2,'catalog.variant.attributes',$3,$4::jsonb)`,
    [auth.storeId,auth.userId,request.params.id,JSON.stringify({revision:rev,sku:normalized.sku})]);
   await client.query(`INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload)
    VALUES($1,'catalog.variant.updated.v1',$2,$3,$4::jsonb)`,
    [auth.storeId,request.params.id,rev,JSON.stringify({revision:rev})]);
   return {id:request.params.id,revision:rev,...normalized};
  });
  return out.result;
 });

}
