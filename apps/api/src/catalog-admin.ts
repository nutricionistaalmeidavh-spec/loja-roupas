import { createHash } from 'node:crypto';
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
  const response=await withIdempotentTransaction(db,auth,'catalog.photo:'+request.params.id,key,{sha256,type},async client=>{
   const exists=await client.query('SELECT id FROM products WHERE id=$1 AND store_id=$2 FOR KEY SHARE',
     [request.params.id,auth.storeId]);
   if(!exists.rowCount)throw new DomainError(404,'NOT_FOUND','Produto não encontrado');
   await client.query(`INSERT INTO product_photos(product_id,store_id,content_type,image_bytes,sha256)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(product_id,store_id) DO UPDATE SET
    content_type=EXCLUDED.content_type,image_bytes=EXCLUDED.image_bytes,sha256=EXCLUDED.sha256,updated_at=now()`,
    [request.params.id,auth.storeId,type,bytes,sha256]);
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail) VALUES
     ($1,$2,'catalog.photo.update',$3,$4::jsonb)`,[auth.storeId,auth.userId,request.params.id,JSON.stringify({sha256,type})]);
   return {product_id:request.params.id,sha256,content_type:type};
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
}
