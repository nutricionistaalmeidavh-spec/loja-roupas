import {createHash} from 'node:crypto';
import sharp from 'sharp';
import type {FastifyInstance,FastifyReply} from 'fastify';
import type {Pool} from 'pg';
import {requirePermission} from './auth.ts';
import {DomainError,requireIdempotencyKey,withIdempotentTransaction} from './transactions.ts';

const uuid='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
const productParams={type:'object',required:['id'],additionalProperties:false,properties:{id:{type:'string',pattern:uuid}}} as const;
const imageParams={type:'object',required:['id','photoId'],additionalProperties:false,
 properties:{id:{type:'string',pattern:uuid},photoId:{type:'string',pattern:uuid}}} as const;
const versionQuery={type:'object',additionalProperties:false,properties:{v:{type:'string',pattern:'^[a-f0-9]{64}$'}}} as const;

function validateImage(bytes:Buffer,type:string){
 const png=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
 const jpeg=bytes.length>3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
 const webp=bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(bytes.length<16||bytes.length>2097152||
    !(type==='image/png'&&png||type==='image/jpeg'&&jpeg||type==='image/webp'&&webp))
  throw new DomainError(415,'INVALID_IMAGE','Imagem inválida. Use PNG, JPEG ou WebP de até 2 MiB.');
}
async function makeThumbnail(bytes:Buffer,type:string){
 try{
  const meta=await sharp(bytes,{limitInputPixels:16_000_000,failOn:'error'}).metadata();
  const expected=type==='image/png'?'png':type==='image/jpeg'?'jpeg':'webp';
  if(meta.format!==expected)throw Error('Formato incompatível');
  const thumb=await sharp(bytes,{limitInputPixels:16_000_000,failOn:'error'}).rotate()
   .resize({width:480,height:640,fit:'inside',withoutEnlargement:true}).webp({quality:68}).toBuffer();
  if(thumb.length<16||thumb.length>524288)throw Error('Miniatura excedeu limite');
  return thumb;
 }catch{throw new DomainError(415,'INVALID_IMAGE','Imagem não pode ser processada ou excede o limite de resolução');}
}
function sendThumbnail(reply:FastifyReply,bytes:Buffer,sha256:string,version?:string,ifNoneMatch?:string|string[]){
 const etag='"'+sha256+'"';
 reply.header('etag',etag).header('vary','Authorization, X-Store-Id')
  .header('cache-control',version===sha256?'private, max-age=31536000, immutable':'private, no-cache')
  .header('x-content-type-options','nosniff');
 if(ifNoneMatch===etag)return reply.code(304).send();
 return reply.type('image/webp').send(bytes);
}
export function registerCatalogGallery(app:FastifyInstance,db:Pool){
 app.get<{Params:{id:string}}>('/v1/catalog/products/:id/gallery',{
  schema:{params:productParams}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'catalog.read'))return reply;
  const id=request.params.id,store=request.authContext!.storeId;
  const product=await db.query('SELECT id FROM products WHERE id=$1 AND store_id=$2',[id,store]);
  if(!product.rowCount)throw new DomainError(404,'NOT_FOUND','Produto não encontrado');
  const [main,gallery]=await Promise.all([
   db.query<{sha256:string;updated_at:Date}>('SELECT sha256,updated_at FROM product_photos WHERE product_id=$1 AND store_id=$2',[id,store]),
   db.query<{id:string;position:number;sha256:string;variant_id:string|null;created_at:Date}>(
    'SELECT id::text,position,sha256,variant_id::text,created_at FROM product_gallery_photos WHERE store_id=$1 AND product_id=$2 ORDER BY position,id',
    [store,id])
  ]);
  return {items:[
   ...(main.rowCount?[{id:'primary',position:0,sha256:main.rows[0].sha256,variant_id:null,primary:true}]:[]),
   ...gallery.rows.map(row=>({id:row.id,position:row.position,sha256:row.sha256,variant_id:row.variant_id,primary:false}))
  ]};
 });
 app.post<{Params:{id:string};Querystring:{variant_id?:string};Body:Buffer}>('/v1/catalog/products/:id/gallery',{
  schema:{params:productParams,querystring:{type:'object',additionalProperties:false,properties:{
   variant_id:{type:'string',pattern:uuid}
  }}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'catalog.write'))return reply;
  const bytes=request.body;
  const type=String(request.headers['content-type']??'').split(';')[0].trim().toLowerCase();
  if(!Buffer.isBuffer(bytes))throw new DomainError(415,'INVALID_IMAGE','Imagem binária obrigatória');
  validateImage(bytes,type);
  const thumb=await makeThumbnail(bytes,type);
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const auth=request.authContext!,productId=request.params.id,variantId=request.query.variant_id??null;
  const key=requireIdempotencyKey(request.headers['idempotency-key']);
  const output=await withIdempotentTransaction(db,auth,'catalog.gallery.add:'+productId,key,
   {sha256,type,variant_id:variantId},async client=>{
   const product=await client.query<{revision:string}>('SELECT revision::text FROM products WHERE id=$1 AND store_id=$2 FOR UPDATE',[productId,auth.storeId]);
   if(!product.rowCount)throw new DomainError(404,'NOT_FOUND','Produto não encontrado');
   if(variantId){
    const variant=await client.query('SELECT id FROM product_variants WHERE id=$1 AND store_id=$2 AND product_id=$3',
     [variantId,auth.storeId,productId]);
    if(!variant.rowCount)throw new DomainError(422,'INVALID_VARIANT','Variante não pertence ao produto desta loja');
   }
   const existing=await client.query<{position:number;sha256:string}>(
    'SELECT position,sha256 FROM product_gallery_photos WHERE store_id=$1 AND product_id=$2 ORDER BY position',
    [auth.storeId,productId]);
   if(existing.rows.some(row=>row.sha256===sha256))
    throw new DomainError(409,'DUPLICATE_PHOTO','Essa fotografia já existe na galeria');
   const occupied=new Set(existing.rows.map(row=>Number(row.position)));
   const position=[1,2,3,4,5,6,7].find(n=>!occupied.has(n));
   if(!position)throw new DomainError(409,'GALLERY_FULL','Limite de 8 fotos por produto (principal + 7 adicionais)');
   const inserted=await client.query<{id:string}>(
    'INSERT INTO product_gallery_photos(store_id,product_id,variant_id,position,content_type,image_bytes,thumb_bytes,sha256) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id::text',
    [auth.storeId,productId,variantId,position,type,bytes,thumb,sha256]);
   await client.query('INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail) '+
    "VALUES($1,$2,'catalog.gallery.add',$3,$4::jsonb)",
    [auth.storeId,auth.userId,productId,JSON.stringify({photo_id:inserted.rows[0].id,sha256,variant_id:variantId})]);
   await client.query('INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload) '+
    "VALUES($1,'catalog.gallery.updated.v1',$2,$3,$4::jsonb)",
    [auth.storeId,productId,Number(product.rows[0].revision),JSON.stringify({photo_id:inserted.rows[0].id,action:'add'})]);
   return {id:inserted.rows[0].id,position,sha256,variant_id:variantId};
  });
  return reply.code(201).send(output.result);
 });
 app.delete<{Params:{id:string;photoId:string}}>('/v1/catalog/products/:id/gallery/:photoId',{
  schema:{params:imageParams}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'catalog.write'))return reply;
  const auth=request.authContext!,{id,photoId}=request.params;
  const key=requireIdempotencyKey(request.headers['idempotency-key']);
  const output=await withIdempotentTransaction(db,auth,'catalog.gallery.delete:'+photoId,key,{product_id:id,photo_id:photoId},async client=>{
   const product=await client.query<{revision:string}>('SELECT revision::text FROM products WHERE id=$1 AND store_id=$2 FOR UPDATE',[id,auth.storeId]);
   if(!product.rowCount)throw new DomainError(404,'NOT_FOUND','Produto não encontrado');
   const deleted=await client.query('DELETE FROM product_gallery_photos WHERE store_id=$1 AND product_id=$2 AND id=$3 RETURNING id',
    [auth.storeId,id,photoId]);
   if(!deleted.rowCount)throw new DomainError(404,'NO_IMAGE','Fotografia não encontrada');
   await client.query('INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail) '+
    "VALUES($1,$2,'catalog.gallery.delete',$3,$4::jsonb)",
    [auth.storeId,auth.userId,id,JSON.stringify({photo_id:photoId})]);
   await client.query('INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload) '+
    "VALUES($1,'catalog.gallery.updated.v1',$2,$3,$4::jsonb)",
    [auth.storeId,id,Number(product.rows[0].revision),JSON.stringify({photo_id:photoId,action:'delete'})]);
   return {deleted:true,id:photoId};
  });
  return output.result;
 });
 app.get<{Params:{id:string;photoId:string};Querystring:{v?:string}}>(
 '/v1/catalog/products/:id/gallery/:photoId/thumbnail',{
  schema:{params:imageParams,querystring:versionQuery}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'catalog.read'))return reply;
  const row=await db.query<{thumb_bytes:Buffer;sha256:string}>(
   'SELECT thumb_bytes,sha256 FROM product_gallery_photos WHERE store_id=$1 AND product_id=$2 AND id=$3',
   [request.authContext!.storeId,request.params.id,request.params.photoId]);
  if(!row.rowCount)throw new DomainError(404,'NO_IMAGE','Fotografia não encontrada');
  return sendThumbnail(reply,row.rows[0].thumb_bytes,row.rows[0].sha256,request.query.v,request.headers['if-none-match']);
 });
}
