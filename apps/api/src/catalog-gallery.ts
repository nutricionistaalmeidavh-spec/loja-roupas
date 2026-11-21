import {createHash} from 'node:crypto';
import sharp from 'sharp';
import type {FastifyInstance} from 'fastify';
import type {Pool} from 'pg';
import {requirePermission} from './auth.ts';
import {DomainError,requireIdempotencyKey,withIdempotentTransaction} from './transactions.ts';

const uid='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
const params={type:'object',required:['id'],properties:{id:{type:'string',pattern:uid}}} as const;
const photoParams={type:'object',required:['id','photoId'],properties:{id:{type:'string',pattern:uid},photoId:{type:'string',pattern:uid}}} as const;
const versionQuery={type:'object',additionalProperties:false,properties:{v:{type:'string',pattern:'^[a-f0-9]{64}$'}}} as const;
type Photo={id:string;variant_id:string|null;sha256:string;content_type:string;created_at:Date};
function verifyImage(bytes:unknown,type:string):asserts bytes is Buffer{
 if(!Buffer.isBuffer(bytes)||bytes.length<16||bytes.length>2097152)
  throw new DomainError(415,'INVALID_IMAGE','Imagem inválida; limite de 2 MiB');
 const png=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
 const jpg=bytes.length>3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 const webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!(type==='image/png'&&png||type==='image/jpeg'&&jpg||type==='image/webp'&&webp))
  throw new DomainError(415,'INVALID_IMAGE','Formato inválido: PNG, JPEG ou WebP');
}
async function thumbnail(bytes:Buffer,type:string):Promise<Buffer>{
 try{
  const image=sharp(bytes,{limitInputPixels:16_000_000,failOn:'error'});
  const meta=await image.metadata();
  if(meta.format!==(type==='image/png'?'png':type==='image/jpeg'?'jpeg':'webp'))throw Error('format');
  const thumb=await sharp(bytes,{limitInputPixels:16_000_000,failOn:'error'})
   .rotate().resize({width:480,height:640,fit:'inside',withoutEnlargement:true})
   .webp({quality:68}).toBuffer();
  if(thumb.length<16||thumb.length>524288)throw Error('size');
  return thumb;
 }catch{throw new DomainError(415,'INVALID_IMAGE','Imagem inválida ou resolução excessiva');}
}
function sendPhoto(reply:any,row:{bytes:Buffer;sha256:string},version?:string,ifNoneMatch?:string){
 if(version&&version!==row.sha256)throw new DomainError(409,'PHOTO_CHANGED','Fotografia alterada; recarregue o catálogo');
 const etag='"'+row.sha256+'"';
 reply.header('etag',etag).header('cache-control',version?'private, max-age=86400, immutable':'private, no-store')
  .header('x-content-type-options','nosniff');
 if(ifNoneMatch===etag)return reply.code(304).send();
 return reply.type('image/webp').send(row.bytes);
}

export function registerCatalogGallery(app:FastifyInstance,db:Pool){
 app.get<{Params:{id:string}}>('/v1/catalog/products/:id/photos',{schema:{params}},async(request,reply)=>{
  if(requirePermission(request,reply,'catalog.read'))return reply;
  const store=request.authContext!.storeId,id=request.params.id;
  const product=await db.query('SELECT id FROM products WHERE id=$1 AND store_id=$2',[id,store]);
  if(!product.rowCount)throw new DomainError(404,'NOT_FOUND','Produto não encontrado');
  const [primary,extras]=await Promise.all([
   db.query<{sha256:string;content_type:string;updated_at:Date}>(
    'SELECT sha256,content_type,updated_at FROM product_photos WHERE product_id=$1 AND store_id=$2',[id,store]),
   db.query<Photo>('SELECT id::text,variant_id::text,sha256,content_type,created_at FROM product_gallery_photos '+
    'WHERE product_id=$1 AND store_id=$2 ORDER BY created_at,id',[id,store])
  ]);
  return {items:[
   ...primary.rows.map(p=>({id:'primary',variant_id:null,sha256:p.sha256,content_type:p.content_type,is_primary:true,created_at:p.updated_at})),
   ...extras.rows.map(p=>({...p,is_primary:false}))
  ]};
 });
 app.post<{Params:{id:string};Querystring:{variant_id?:string};Body:Buffer}>('/v1/catalog/products/:id/photos',{
  schema:{params,querystring:{type:'object',additionalProperties:false,properties:{variant_id:{type:'string',pattern:uid}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'catalog.write'))return reply;
  const type=String(request.headers['content-type']??'').split(';')[0].trim().toLowerCase();
  verifyImage(request.body,type);
  const bytes=request.body,thumb=await thumbnail(bytes,type);
  const hash=createHash('sha256').update(bytes).digest('hex');
  const auth=request.authContext!,productId=request.params.id,variantId=request.query.variant_id??null;
  const key=requireIdempotencyKey(request.headers['idempotency-key']);
  const result=await withIdempotentTransaction(db,auth,'catalog.photo.gallery.add:'+productId,key,
   {hash,type,variantId},async client=>{
    const locked=await client.query('SELECT id FROM products WHERE store_id=$1 AND id=$2 FOR UPDATE',[auth.storeId,productId]);
    if(!locked.rowCount)throw new DomainError(404,'NOT_FOUND','Produto não encontrado');
    const primary=await client.query('SELECT product_id FROM product_photos WHERE store_id=$1 AND product_id=$2',[auth.storeId,productId]);
    if(!primary.rowCount)throw new DomainError(409,'PRIMARY_REQUIRED','Cadastre a foto principal antes de adicionar fotos extras');
    if(variantId){
     const match=await client.query('SELECT id FROM product_variants WHERE store_id=$1 AND product_id=$2 AND id=$3',
      [auth.storeId,productId,variantId]);
     if(!match.rowCount)throw new DomainError(422,'BAD_VARIANT','Variante não pertence ao produto');
    }
    const count=await client.query<{total:string}>('SELECT count(*)::text AS total FROM product_gallery_photos WHERE store_id=$1 AND product_id=$2',
     [auth.storeId,productId]);
    if(Number(count.rows[0].total)>=7)throw new DomainError(409,'PHOTO_LIMIT','Limite de oito fotos por produto');
    const saved=await client.query<{id:string}>('INSERT INTO product_gallery_photos(store_id,product_id,variant_id,content_type,image_bytes,thumb_bytes,sha256) '+
     'VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id::text',[auth.storeId,productId,variantId,type,bytes,thumb,hash]);
    const id=saved.rows[0].id;
    const rev=await client.query<{revision:string}>(
     'UPDATE products SET revision=revision+1 WHERE store_id=$1 AND id=$2 RETURNING revision::text',[auth.storeId,productId]);
    const version=Number(rev.rows[0].revision);
    await client.query("INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail) VALUES($1,$2,'catalog.photo.gallery.add',$3,$4::jsonb)",
     [auth.storeId,auth.userId,productId,JSON.stringify({photo_id:id,variant_id:variantId,sha256:hash})]);
    await client.query("INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload) VALUES($1,'catalog.product.updated.v1',$2,$3,$4::jsonb)",
     [auth.storeId,productId,version,JSON.stringify({revision:version,media:true})]);
    return {id,product_id:productId,variant_id:variantId,sha256:hash,revision:version};
   });
  return reply.code(201).send(result.result);
 });
 app.get<{Params:{id:string;photoId:string};Querystring:{v?:string}}>('/v1/catalog/products/:id/photos/:photoId/thumbnail',{
  schema:{params:photoParams,querystring:versionQuery}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'catalog.read'))return reply;
  const result=await db.query<{bytes:Buffer;sha256:string}>(
   'SELECT thumb_bytes AS bytes,sha256 FROM product_gallery_photos WHERE store_id=$1 AND product_id=$2 AND id=$3',
   [request.authContext!.storeId,request.params.id,request.params.photoId]);
  if(!result.rowCount)throw new DomainError(404,'NO_IMAGE','Foto não encontrada');
  return sendPhoto(reply,result.rows[0],request.query.v,request.headers['if-none-match']);
 });
 app.delete<{Params:{id:string;photoId:string}}>('/v1/catalog/products/:id/photos/:photoId',{
  schema:{params:photoParams}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'catalog.write'))return reply;
  const auth=request.authContext!,{id,photoId}=request.params;
  const key=requireIdempotencyKey(request.headers['idempotency-key']);
  const result=await withIdempotentTransaction(db,auth,'catalog.photo.gallery.delete:'+id+':'+photoId,key,
   {id,photoId},async client=>{
    const product=await client.query('SELECT id FROM products WHERE store_id=$1 AND id=$2 FOR UPDATE',[auth.storeId,id]);
    if(!product.rowCount)throw new DomainError(404,'NOT_FOUND','Produto não encontrado');
    const deleted=await client.query<{sha256:string;variant_id:string|null}>(
     'DELETE FROM product_gallery_photos WHERE store_id=$1 AND product_id=$2 AND id=$3 RETURNING sha256,variant_id::text',
     [auth.storeId,id,photoId]);
    if(!deleted.rowCount)throw new DomainError(404,'NO_IMAGE','Foto não encontrada');
    const rev=await client.query<{revision:string}>(
     'UPDATE products SET revision=revision+1 WHERE store_id=$1 AND id=$2 RETURNING revision::text',[auth.storeId,id]);
    const version=Number(rev.rows[0].revision);
    await client.query("INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail) VALUES($1,$2,'catalog.photo.gallery.delete',$3,$4::jsonb)",
     [auth.storeId,auth.userId,id,JSON.stringify({photo_id:photoId,...deleted.rows[0]})]);
    await client.query("INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload) VALUES($1,'catalog.product.updated.v1',$2,$3,$4::jsonb)",
     [auth.storeId,id,version,JSON.stringify({revision:version,media:true})]);
    return {deleted:true,photo_id:photoId,revision:version};
   });
  return result.result;
 });
}
