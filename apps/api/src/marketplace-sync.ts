import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import sharp from 'sharp';
import {marketplaceBaseUrl,listingFingerprint,nextListingRevision,normalizeRemoteOrder} from './marketplace-sync-core.ts';
import type {Listing} from './marketplace-sync-core.ts';
import {openSyncKey} from './marketplace-secrets.ts';

type Link={slug:string;secret_encrypted:string;order_cursor:string|null};
type Variant={id:string;product_id:string;name:string;category:string;color:string;size:string;price_cents:string;available:string;
 storefront_published:boolean;photo_hash:string|null;revision:string|null;fingerprint:string|null};
type Pending={variant_id:string;revision:string;payload:Listing & {revision:number}};
const errorText=(err:unknown)=>String(err instanceof Error?err.message:'Erro de sincronização').replace(/Bearer [a-z0-9_-]+/gi,'Bearer [oculto]').slice(0,240);
async function remote<T>(base:URL,key:string,path:string,method='GET',body?:unknown,transport:typeof fetch=fetch):Promise<T>{
 const res=await transport(new URL(path,base),{method,redirect:'manual',cache:'no-store',
  headers:{authorization:'Bearer '+key,...(body!==undefined?{'content-type':'application/json'}:{})},
  ...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(9000)});
 if(!res.ok)throw new Error('Marketplace retornou HTTP '+res.status+' em '+method+' '+path.split('?')[0]);
 return res.json() as Promise<T>;
}
async function publishPhoto(db:Pool,storeId:string,base:URL,key:string,productId:string,sourceHash:string|null,transport:typeof fetch){
 const saved=await db.query<{source_hash:string}>('SELECT source_hash FROM marketplace_photos WHERE store_id=$1 AND product_id=$2',[storeId,productId]);
 if((saved.rows[0]?.source_hash??null)===sourceHash)return;
 if(!sourceHash){
  if(saved.rowCount){
   await remote(base,key,'/v1/sync/photos/'+productId,'DELETE',undefined,transport);
   await db.query('DELETE FROM marketplace_photos WHERE store_id=$1 AND product_id=$2',[storeId,productId]);
  }
  return;
 }
 const photo=await db.query<{bytes:Buffer}>('SELECT coalesce(thumb_bytes,image_bytes) AS bytes FROM product_photos WHERE store_id=$1 AND product_id=$2',[storeId,productId]);
 if(!photo.rowCount)throw new Error('Foto local removida durante a sincronização');
 let bytes=Buffer.alloc(0);
 for(const [width,quality] of [[550,72],[420,65],[300,55],[200,45]]){
  bytes=await sharp(photo.rows[0].bytes,{limitInputPixels:20_000_000}).rotate().resize({width,height:width,fit:'inside',withoutEnlargement:true})
   .webp({quality,effort:2}).toBuffer();
  if(bytes.length<=65_000)break;
 }
 if(bytes.length<24||bytes.length>65_000)throw new Error('Foto ultrapassa 65KB mesmo após conversão');
 const digest=createHash('sha256').update(bytes).digest('hex');
 const accepted=await remote<{ok:boolean;sha256:string}>(base,key,'/v1/sync/photos/'+productId,'PUT',
  {mime:'image/webp',content_base64:bytes.toString('base64'),sha256:digest},transport);
 if(!accepted.ok||accepted.sha256!==digest)throw new Error('Worker não confirmou o upload da foto');
 await db.query('INSERT INTO marketplace_photos(store_id,product_id,source_hash) VALUES($1,$2,$3) ON CONFLICT(store_id,product_id) DO UPDATE SET source_hash=excluded.source_hash',
  [storeId,productId,sourceHash]);
}
async function enqueueCatalog(db:Pool,storeId:string,base:URL,key:string,slug:string,transport:typeof fetch){
 let last:string|null=null;
 const seen=new Set<string>();
 for(let index=0;index<100;index++){
  const rows=await db.query<Variant>(
   'SELECT v.id::text,p.id::text AS product_id,p.name,p.category,v.color,v.size,v.price_cents::text,'+
   ' greatest(0,coalesce(b.on_hand,0)-coalesce(b.reserved,0))::text AS available,v.storefront_published,'+
   ' ph.sha256 AS photo_hash,l.revision::text,l.fingerprint'+
   ' FROM product_variants v JOIN products p ON p.id=v.product_id AND p.store_id=v.store_id'+
   ' LEFT JOIN stock_balances b ON b.store_id=v.store_id AND b.variant_id=v.id'+
   ' LEFT JOIN product_photos ph ON ph.store_id=v.store_id AND ph.product_id=p.id'+
   ' LEFT JOIN marketplace_listings l ON l.store_id=v.store_id AND l.variant_id=v.id'+
   ' WHERE v.store_id=$1 AND ($2::uuid IS NULL OR v.id>$2::uuid) AND (v.storefront_published OR l.variant_id IS NOT NULL)'+
   ' ORDER BY v.id LIMIT 200',[storeId,last]);
  for(const row of rows.rows){
   last=row.id;
   if(!seen.has(row.product_id)){
    await publishPhoto(db,storeId,base,key,row.product_id,row.storefront_published?row.photo_hash:null,transport);
    seen.add(row.product_id);
   }
   const listing:Listing={id:row.id,product_id:row.product_id,name:row.name,category:row.category,
    color:row.color,size:row.size,price_cents:Number(row.price_cents),available:Number(row.available),
    published:row.storefront_published,photo_url:row.storefront_published&&row.photo_hash?
      new URL('/v1/media/'+slug+'/'+row.product_id,base).href:null};
   if(!Number.isSafeInteger(listing.price_cents)||!Number.isSafeInteger(listing.available)||
      listing.price_cents>9999999999||listing.available>1000000)throw new Error('Preço ou quantidade fora dos limites de sincronização');
   const fingerprint=listingFingerprint(listing);
   if(fingerprint===row.fingerprint)continue;
   const revision=nextListingRevision(Number(row.revision||0));
   await db.query('INSERT INTO marketplace_listings(store_id,variant_id,revision,fingerprint,payload) VALUES($1,$2,$3,$4,$5::jsonb)'+
    ' ON CONFLICT(store_id,variant_id) DO UPDATE SET revision=excluded.revision,fingerprint=excluded.fingerprint,payload=excluded.payload',
    [storeId,row.id,revision,fingerprint,JSON.stringify({...listing,revision})]);
  }
  if(rows.rows.length<200)return;
 }
 throw new Error('Catálogo acima do limite de 20 mil peças por ciclo');
}
async function pushCatalog(db:Pool,storeId:string,base:URL,key:string,transport:typeof fetch){
 let delivered=0;
 for(let i=0;i<200;i++){
  const batch=await db.query<Pending>('SELECT variant_id::text,revision::text,payload FROM marketplace_listings WHERE store_id=$1 AND delivered_revision<revision ORDER BY variant_id LIMIT 50',[storeId]);
  if(!batch.rows.length)break;
  const response=await remote<{ok:boolean;received:number}>(base,key,'/v1/sync/catalog','PUT',
    {items:batch.rows.map(x=>x.payload)},transport);
  if(!response.ok||response.received!==batch.rows.length)throw new Error('Lote não confirmado pelo marketplace');
  for(const x of batch.rows)await db.query('UPDATE marketplace_listings SET delivered_revision=$3 WHERE store_id=$1 AND variant_id=$2 AND revision=$3',
    [storeId,x.variant_id,x.revision]);
  delivered+=batch.rows.length;
 }
 return delivered;
}
async function pullOrders(db:Pool,storeId:string,base:URL,key:string,cursor:string|null,transport:typeof fetch){
 let current=cursor,received=0;
 for(let i=0;i<100;i++){
  const response=await remote<{orders:unknown[];next:string|null}>(base,key,'/v1/sync/orders'+
   (current?'?after='+encodeURIComponent(current):''),'GET',undefined,transport);
  if(!Array.isArray(response.orders)||response.orders.length>100)throw new Error('Resposta de pedidos inválida');
  for(const raw of response.orders){
   const order=normalizeRemoteOrder(raw),client=await db.connect();
   try{
    await client.query('BEGIN');
    const inserted=await client.query('INSERT INTO marketplace_orders(store_id,remote_id,request_id,customer_name,customer_phone,remote_status,created_at)'+
     ' VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(store_id,remote_id) DO NOTHING RETURNING remote_id',
     [storeId,order.id,order.request_id,order.customer_name,order.customer_phone,order.status,order.created_at]);
    if(inserted.rowCount){
     for(const line of order.lines)await client.query('INSERT INTO marketplace_order_lines(store_id,remote_id,variant_id,quantity) VALUES($1,$2,$3,$4)',
      [storeId,order.id,line.variant_id,line.quantity]);
     received++;
    }
    await client.query('COMMIT');
   }catch(error){await client.query('ROLLBACK');throw error;}
   finally{client.release();}
   current=order.id;
  }
  if(current&&current!==cursor){
   await db.query('UPDATE marketplace_links SET order_cursor=$2 WHERE store_id=$1',[storeId,current]);
   cursor=current;
  }
  if(!response.next)return received;
  if(response.next!==current)throw new Error('Paginação remota inconsistente');
 }
 throw new Error('Fila de pedidos extensa. Reexecute a sincronização.');
}
async function pushDecisions(db:Pool,storeId:string,base:URL,key:string,transport:typeof fetch){
 const rows=await db.query<{remote_id:string;status:string}>(
  "SELECT remote_id::text,status FROM marketplace_orders WHERE store_id=$1 AND status<>remote_status AND status IN ('accepted','rejected') ORDER BY updated_at,remote_id LIMIT 100",[storeId]);
 for(const row of rows.rows){
  const result=await remote<{id:string;status:string}>(base,key,'/v1/sync/orders/'+row.remote_id,'PATCH',{status:row.status},transport);
  if(result.status!==row.status)throw new Error('Status remoto não confirmado');
  await db.query('UPDATE marketplace_orders SET remote_status=$3 WHERE store_id=$1 AND remote_id=$2 AND status=$3',
   [storeId,row.remote_id,row.status]);
 }
 return rows.rows.length;
}
export async function syncMarketplaceStore(db:Pool,storeId:string,transport:typeof fetch=fetch){
 const client=await db.connect();
 try{
  const lock=await client.query<{ok:boolean}>('SELECT pg_try_advisory_lock(9245,hashtext($1::text)) AS ok',[storeId]);
  if(!lock.rows[0]?.ok)return {busy:true,received:0,decisions:0,published:0};
  try{
   const row=await db.query<Link>('SELECT slug,secret_encrypted,order_cursor FROM marketplace_links WHERE store_id=$1 AND enabled=true',[storeId]);
   if(!row.rowCount)return {disabled:true,received:0,decisions:0,published:0};
   const link=row.rows[0],base=marketplaceBaseUrl(),key=await openSyncKey(link.secret_encrypted);
   await db.query('UPDATE marketplace_links SET last_attempt_at=now(),last_error=NULL WHERE store_id=$1',[storeId]);
   try{
    const received=await pullOrders(db,storeId,base,key,link.order_cursor,transport);
    const decisions=await pushDecisions(db,storeId,base,key,transport);
    await enqueueCatalog(db,storeId,base,key,link.slug,transport);
    const published=await pushCatalog(db,storeId,base,key,transport);
    await db.query('UPDATE marketplace_links SET last_success_at=now(),last_error=NULL WHERE store_id=$1',[storeId]);
    return {received,decisions,published};
   }catch(error){
    await db.query('UPDATE marketplace_links SET last_error=$2 WHERE store_id=$1',[storeId,errorText(error)]).catch(()=>{});
    throw error;
   }
  }finally{await client.query('SELECT pg_advisory_unlock(9245,hashtext($1::text))',[storeId]);}
 }finally{client.release();}
}
export function startMarketplacePolling(db:Pool,report:(message:string)=>void){
 let running=false,stopped=false;
 const tick=async()=>{
  if(running||stopped)return;
  running=true;
  try{
   const tenants=await db.query<{store_id:string}>('SELECT store_id::text FROM marketplace_links WHERE enabled=true ORDER BY store_id');
   for(const row of tenants.rows){
    try{await syncMarketplaceStore(db,row.store_id);}
    catch(error){report('Marketplace '+row.store_id+': '+errorText(error));}
   }
  }catch(error){report('Marketplace polling: '+errorText(error));}
  finally{running=false;}
 };
 const timer=setInterval(()=>void tick(),60_000);timer.unref();void tick();
 return ()=>{stopped=true;clearInterval(timer);};
}
