import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { requirePermission } from './auth.ts';
import { DomainError } from './transactions.ts';

type Row = {
 product_id:string;name:string;category:string;product_revision:string;has_photo:boolean;photo_version:string|null;
 variant_id:string;sku:string;barcode:string|null;color:string;size:string;
 price_cents:string;available:string;revision:string;variant_revision:string;
};
type Cursor = {name:string;id:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function decodeCursor(raw:string|undefined):Cursor|null {
 if(!raw)return null;
 if(raw.length>512)throw new DomainError(400,'BAD_CURSOR','Cursor inválido');
 try {
   const obj=JSON.parse(Buffer.from(raw,'base64url').toString('utf8')) as Cursor;
   if(typeof obj.name!=='string'||obj.name.length>200||typeof obj.id!=='string'||!uuid.test(obj.id))throw Error('invalid');
   return obj;
 }catch{throw new DomainError(400,'BAD_CURSOR','Cursor inválido');}
}
function encodeCursor(name:string,id:string){return Buffer.from(JSON.stringify({name,id})).toString('base64url');}
function serializeProducts(rows:Row[],limit:number){
  type Variant={id:string;product_id:string;sku:string;barcode:string|null;color:string;size:string;price_cents:number;available:number;revision:number;variant_revision:number};
  const byId=new Map<string,{id:string;name:string;category:string;revision:number;has_photo:boolean;photo_version:string|null;variants:Variant[]}>();
  for(const row of rows) {
    if(!byId.has(row.product_id))byId.set(row.product_id,{
      id:row.product_id,name:row.name,category:row.category,revision:Number(row.product_revision??1),
      has_photo:row.has_photo===true,photo_version:row.photo_version??null,variants:[]
    });
    const price=Number(row.price_cents),available=Number(row.available),revision=Number(row.revision??0),variantRevision=Number(row.variant_revision??1);
    if(![price,available,revision,variantRevision].every(Number.isSafeInteger) || price<0 || available<0)
      throw new Error('Dados de catálogo fora dos limites');
    byId.get(row.product_id)!.variants.push({
      id:row.variant_id,product_id:row.product_id,sku:row.sku,barcode:row.barcode,
      color:row.color,size:row.size,price_cents:price,available,revision,variant_revision:variantRevision
    });
  }
  const all=[...byId.values()], items=all.slice(0,limit);
  return {items,next_cursor:all.length>limit?encodeCursor(items[items.length-1].name,items[items.length-1].id):null};
}

export function registerCatalog(app:FastifyInstance,db:Pick<Pool,'query'>){
 app.get<{Querystring:{query?:string;limit?:number;cursor?:string;category?:string;exact?:boolean}}>('/v1/catalog/products',{
  schema:{querystring:{type:'object',additionalProperties:false,properties:{exact:{type:'boolean'},
   query:{type:'string',maxLength:100},limit:{type:'integer',minimum:1,maximum:50,default:30},
   cursor:{type:'string',maxLength:512},category:{type:'string',maxLength:100}
  }}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'catalog.read'))return reply;
  const {query='',limit=30,cursor,category='',exact=false}=request.query;
  const after=decodeCursor(cursor);
  const rows=await db.query<Row>(`SELECT p.id::text AS product_id,p.name,p.category,p.revision::text AS product_revision,
    (img.product_id IS NOT NULL) AS has_photo,img.sha256::text AS photo_version,
    v.id::text AS variant_id,v.sku,v.barcode,v.color,v.size,v.price_cents::text,
    (coalesce(s.on_hand,0)-coalesce(s.reserved,0))::text AS available,
    coalesce(s.revision,0)::text AS revision,v.revision::text AS variant_revision
    FROM (
      SELECT DISTINCT p0.id,p0.name,p0.category,p0.revision
      FROM products p0
      JOIN product_variants v0 ON v0.product_id=p0.id AND v0.store_id=p0.store_id
      WHERE p0.store_id=$1 AND (
        ($7 AND (upper(v0.sku)=upper($2) OR upper(v0.barcode)=upper($2))) OR
        (NOT $7 AND ($2='' OR p0.name ILIKE '%'||$2||'%' OR v0.sku ILIKE '%'||$2||'%' OR v0.barcode=$2))
      )
      AND ($4::text IS NULL OR (p0.name,p0.id) > ($4::text,$5::uuid))
      AND ($6='' OR p0.category=$6)
      ORDER BY p0.name,p0.id LIMIT $3
    ) p
    JOIN product_variants v ON v.product_id=p.id AND v.store_id=$1
    LEFT JOIN stock_balances s ON s.variant_id=v.id AND s.store_id=v.store_id
    LEFT JOIN product_photos img ON img.product_id=p.id AND img.store_id=$1
    ORDER BY p.name,p.id,v.sku`,[
      request.authContext!.storeId,query.trim(),limit+1,after?.name??null,after?.id??null,category.trim(),exact
    ]);
  return serializeProducts(rows.rows,limit);
 });
 app.get('/v1/catalog/categories',async(request,reply)=>{
  if(requirePermission(request,reply,'catalog.read'))return reply;
  const result=await db.query<{category:string}>(
   'SELECT DISTINCT category FROM products WHERE store_id=$1 ORDER BY category',
   [request.authContext!.storeId]);
  return {categories:result.rows.map(row=>row.category)};
 });
 app.get<{Querystring:{ids:string}}>('/v1/catalog/draft-variants',{
  schema:{querystring:{type:'object',additionalProperties:false,required:['ids'],
   properties:{ids:{type:'string',maxLength:2000,minLength:36}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'catalog.read'))return reply;
  const ids=request.query.ids.split(',');
  if(ids.length>50||ids.some(id=>!uuid.test(id))||new Set(ids).size!==ids.length)
   throw new DomainError(400,'INVALID_VARIANTS','Lista de variantes inválida');
  const data=await db.query<Row>(`SELECT p.id::text AS product_id,p.name,p.category,
   p.revision::text AS product_revision,(img.product_id IS NOT NULL) AS has_photo,img.sha256::text AS photo_version,
   v.id::text AS variant_id,v.sku,v.barcode,v.color,v.size,v.price_cents::text,
   (coalesce(s.on_hand,0)-coalesce(s.reserved,0))::text AS available,
   coalesce(s.revision,0)::text AS revision,v.revision::text AS variant_revision
   FROM product_variants v JOIN products p ON p.id=v.product_id AND p.store_id=v.store_id
   LEFT JOIN stock_balances s ON s.variant_id=v.id AND s.store_id=v.store_id
   LEFT JOIN product_photos img ON img.product_id=p.id AND img.store_id=v.store_id
   WHERE v.store_id=$1 AND v.id = ANY($2::uuid[])
   ORDER BY p.name,p.id,v.sku`,[request.authContext!.storeId,ids]);
  const result=serializeProducts(data.rows,50);
  return {items:result.items,next_cursor:null};
 });

}
