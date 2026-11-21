import test from 'node:test';
import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {buildApp} from '../src/app.ts';

const store='79a43ea3-ff29-4b7c-b7e8-9c78fe139e30';
const product='82df5fca-2c59-49f7-8ac8-38cd1996c229';
const photo='21df5fca-2c59-49f7-8ac8-38cd1996c227';
const token='z'.repeat(43),sha='a'.repeat(64);
const authorized={authorization:'Bearer '+token,'x-store-id':store};

test('galeria exige sessão e filtra todas as imagens por produto e loja',async()=>{
 const queries:Array<{sql:string;params:unknown[]|undefined}>=[];
 const db={query:async(sql:string,params?:unknown[])=>{
  queries.push({sql,params});
  if(sql.includes('FROM auth_sessions s'))return {rowCount:1,rows:[{user_id:'u',store_id:store,roles:['manager']}]};
  if(sql.startsWith('SELECT id FROM products'))return {rowCount:1,rows:[{id:product}]};
  if(sql.includes('SELECT sha256,updated_at FROM product_photos'))return {rowCount:1,rows:[{sha256:sha,updated_at:new Date()}]};
  if(sql.includes('FROM product_gallery_photos')&&sql.includes('position,sha256'))return {rowCount:1,rows:[{
   id:photo,position:1,sha256:sha,variant_id:null,created_at:new Date()
  }]};
  if(sql.includes('SELECT thumb_bytes,sha256 FROM product_gallery_photos'))
   return {rowCount:1,rows:[{sha256:sha,thumb_bytes:Buffer.from('mock-webp')}]};
  return {rowCount:0,rows:[]};
 }};
 const app=buildApp(db as unknown as Pool);
 const path='/v1/catalog/products/'+product+'/gallery';
 assert.equal((await app.inject(path)).statusCode,401);
 const response=await app.inject({url:path,headers:authorized});
 assert.equal(response.statusCode,200);
 const data=response.json();
 assert.deepEqual(data.items.map((x:{id:string})=>x.id),['primary',photo]);
 assert.ok(queries.some(x=>x.sql.includes('FROM product_gallery_photos')&&
  x.params?.[0]===store&&x.params?.[1]===product));
 const thumbnail='/v1/catalog/products/'+product+'/gallery/'+photo+'/thumbnail?v='+sha;
 const image=await app.inject({url:thumbnail,headers:authorized});
 assert.equal(image.statusCode,200);
 assert.equal(image.headers.etag,'"'+sha+'"');
 assert.match(String(image.headers['cache-control']),/private/);
 assert.match(String(image.headers.vary),/Authorization/);
 const notModified=await app.inject({url:thumbnail,headers:{...authorized,'if-none-match':'"'+sha+'"'}});
 assert.equal(notModified.statusCode,304);
 const wrong=await app.inject({url:'/v1/catalog/products/'+product+'/gallery/not-a-uuid',headers:authorized});
 assert.equal(wrong.statusCode,404);
 await app.close();
});
test('upload da galeria rejeita binários falsificados antes de escrever no banco',async()=>{
 const db={query:async(sql:string)=>{
  if(sql.includes('FROM auth_sessions s'))return {rowCount:1,rows:[{user_id:'u',store_id:store,roles:['manager']}]};
  return {rowCount:0,rows:[]};
 }};
 const app=buildApp(db as unknown as Pool);
 const result=await app.inject({method:'POST',url:'/v1/catalog/products/'+product+'/gallery',
  headers:{...authorized,'idempotency-key':'new-gallery-photo','content-type':'image/png'},
  payload:Buffer.alloc(24,1)});
 assert.equal(result.statusCode,415);
 assert.equal(result.json().code,'INVALID_IMAGE');
 await app.close();
});
