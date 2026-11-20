import test from 'node:test';import assert from 'node:assert/strict';
import worker from '../worker.mjs';

test('fotos e chave são isoladas por tenant no Worker',async()=>{
 const key='a'.repeat(64);
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key))),
  x=>x.toString(16).padStart(2,'0')).join('');
 const tenant={id:'tenant-one',slug:'minha-loja',name:'Minha Loja',installation_id:'loja-pc-001'};
 const photoId='9087b531-75bc-4eeb-b7f0-e3656c4a6e33',photos=new Map();
 const db={prepare(sql){
  let params=[];
  return {
   bind(...values){params=values;return this;},
   async first(){
    if(sql.includes('FROM tenants WHERE sync_hash'))return params[0]===digest?tenant:null;
    if(sql.includes('FROM tenants WHERE slug'))return params[0]==='minha-loja'?tenant:{id:'tenant-other',slug:'outra-loja',name:'Outra',installation_id:'other-pc'};
    if(sql.includes('FROM public_photos')){assert.match(sql,/v\.published=1/);return photos.get(params[0]+'|'+params[1])||null;}
    return null;
   },
   async run(){
    if(sql.startsWith('INSERT INTO public_photos'))photos.set(params[0]+'|'+params[1],{content_base64:params[2]});
    if(sql.startsWith('DELETE FROM public_photos'))photos.delete(params[0]+'|'+params[1]);
    return {meta:{changes:1}};
   }
  };
 }};
 const env={DB:db,LICENSE_CENTER:{fetch:async()=>Response.json({active:true,product:'LOJA_ROUPAS'})}};
 const auth={authorization:'Bearer '+key,'content-type':'application/json'};
 const identity=await worker.fetch(new Request('https://site.test/v1/sync/identity',{headers:auth}),env);
 assert.equal((await identity.json()).slug,'minha-loja');
 const raw=new Uint8Array(32);raw.set(new TextEncoder().encode('RIFF'),0);raw.set(new TextEncoder().encode('WEBP'),8);
 const base64=Buffer.from(raw).toString('base64');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),x=>x.toString(16).padStart(2,'0')).join('');
 const send=payload=>new Request('https://site.test/v1/sync/photos/'+photoId,{method:'PUT',headers:auth,body:JSON.stringify(payload)});
 assert.equal((await worker.fetch(send({mime:'image/webp',content_base64:base64,sha256:'f'.repeat(64)}),env)).status,400);
 const saved=await worker.fetch(send({mime:'image/webp',content_base64:base64,sha256:hash}),env);
 assert.equal(saved.status,200,await saved.text());
 const publicPhoto=await worker.fetch(new Request('https://site.test/v1/media/minha-loja/'+photoId),env);
 assert.equal(publicPhoto.status,200);
 assert.equal(publicPhoto.headers.get('content-type'),'image/webp');
 assert.equal((await worker.fetch(new Request('https://site.test/v1/media/outra-loja/'+photoId),env)).status,404);
 assert.equal((await worker.fetch(new Request('https://site.test/v1/sync/identity',{headers:{authorization:'Bearer '+'b'.repeat(64)}}),env)).status,401);
});
