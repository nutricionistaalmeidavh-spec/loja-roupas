import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Pool} from 'pg';
import sharp from 'sharp';
import {buildApp} from '../src/app.ts';
import {syncMarketplaceStore} from '../src/marketplace-sync.ts';
import {sealSyncKey,openSyncKey} from '../src/marketplace-secrets.ts';
import {issueSession} from '../src/security.ts';

test('chave de lojista permanece cifrada e resiste a alteração de bytes',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'loja-sync-test-'));
 try{
  const env={...process.env,LOJA_SYNC_SECRET_DIR:root};
  const original='a'.repeat(64),encrypted=await sealSyncKey(original,env);
  assert.notEqual(encrypted,original);
  assert.equal(await openSyncKey(encrypted,env),original);
  await assert.rejects(openSyncKey(encrypted.slice(0,-2)+'00',env));
 }finally{await rm(root,{recursive:true,force:true});}
});

const uri=process.env.TEST_DATABASE_URL;
test('receber pedido, reservar, reprocessar e recusar sem duplicar estoque', {skip:!uri && 'Requer PostgreSQL de teste'},async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'loja-online-'));
 const previous=process.env.LOJA_SYNC_SECRET_DIR;
 process.env.LOJA_SYNC_SECRET_DIR=folder;
 const db=new Pool({connectionString:uri!}),app=buildApp(db);
 try{
  const store=(await db.query<{id:string}>("INSERT INTO stores(name) VALUES('Marketplace P0 QA') RETURNING id")).rows[0].id;
  const another=(await db.query<{id:string}>("INSERT INTO stores(name) VALUES('Outra Loja P0 QA') RETURNING id")).rows[0].id;
  const product=(await db.query<{id:string}>("INSERT INTO products(store_id,name,category) VALUES($1,'Vestido P0','Feminino') RETURNING id",[store])).rows[0].id;
  const variant=(await db.query<{id:string}>("INSERT INTO product_variants(store_id,product_id,sku,color,size,price_cents,storefront_published) VALUES($1,$2,$3,'Azul','M',14990,true) RETURNING id",[store,product,'SYNC-'+randomUUID().slice(0,8)])).rows[0].id;
  await db.query('INSERT INTO stock_balances(store_id,variant_id,on_hand,revision) VALUES($1,$2,3,1)',[store,variant]);
  const encoded=await sealSyncKey('a'.repeat(64));
  await db.query('INSERT INTO marketplace_links(store_id,slug,secret_encrypted) VALUES($1,$2,$3)',[store,'boutique-p0',encoded]);
  const remoteId=randomUUID(),published:Array<{items:Array<{id:string;available:number;revision:number;photo_url:string|null}>}>=[];
  const transitions:string[]=[];
  let offline=false,photoUploads=0;
  const photo=await sharp({create:{width:20,height:20,channels:3,background:'#88aabb'}}).webp().toBuffer();
  await db.query("INSERT INTO product_photos(store_id,product_id,content_type,image_bytes,sha256,thumb_bytes,thumb_type) VALUES($1,$2,'image/webp',$3,$4,$3,'image/webp')",
   [store,product,photo,'e'.repeat(64)]);
  const transport:typeof fetch=async(input,init)=>{
   if(offline)throw Error('internet offline');
   const url=new URL(String(input));
   if(url.pathname==='/v1/sync/orders'){
    return Response.json({orders:url.searchParams.has('after')?[]:[{id:remoteId,request_id:'request-p0-111',customer_name:'Cliente Final',customer_phone:'',
     status:'pending',created_at:'2026-11-20T11:00:00.000Z',lines:[{variant_id:variant,quantity:2}]}],next:null});
   }
   if(url.pathname.startsWith('/v1/sync/photos/')){
    photoUploads++;
    if(init?.method==='PUT'){
     const payload=JSON.parse(String(init.body));
     assert.equal(payload.mime,'image/webp');
     assert.ok(payload.content_base64.length>30);
     return Response.json({ok:true,sha256:payload.sha256});
    }
    return Response.json({ok:true});
   }
   if(url.pathname==='/v1/sync/catalog'){
    published.push(JSON.parse(String(init?.body)));
    return Response.json({ok:true,received:published.at(-1)!.items.length});
   }
   if(url.pathname.includes('/v1/sync/orders/')){
    const body=JSON.parse(String(init?.body));transitions.push(body.status);
    return Response.json({id:remoteId,status:body.status});
   }
   throw Error('Rota inesperada: '+url.pathname);
  };
  const initial=await syncMarketplaceStore(db,store,transport);
  assert.equal(initial.received,1);assert.equal(initial.published,1);assert.equal(photoUploads,1);
  assert.equal(published[0].items[0].available,3);
  assert.match(published[0].items[0].photo_url||'',/\/v1\/media\/boutique-p0\//);
  const user=(await db.query<{id:string}>('INSERT INTO users(login,password_hash) VALUES($1,$2) RETURNING id',['marketplace-'+randomUUID(),'fixture'])).rows[0].id;
  await db.query("INSERT INTO user_store_roles VALUES($1,$2,'manager')",[user,store]);
  const session=issueSession();
  await db.query("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[user,session.tokenHash]);
  const headers={authorization:'Bearer '+session.token,'x-store-id':store};
  const update=(decision:string)=>app.inject({method:'POST',url:'/v1/management/marketplace/orders/'+remoteId+'/decision',headers,
   payload:{decision}});
  assert.equal((await app.inject({method:'GET',url:'/v1/management/marketplace/orders'})).statusCode,401);
  assert.equal((await update('accepted')).statusCode,200);
  assert.equal((await update('accepted')).json().idempotent,true);
  assert.equal((await db.query('SELECT reserved FROM stock_balances WHERE store_id=$1 AND variant_id=$2',[store,variant])).rows[0].reserved,'2');
  offline=true;
  await assert.rejects(()=>syncMarketplaceStore(db,store,transport));
  assert.equal((await db.query('SELECT status FROM marketplace_orders WHERE store_id=$1 AND remote_id=$2',[store,remoteId])).rows[0].status,'accepted');
  offline=false;
  const accepted=await syncMarketplaceStore(db,store,transport);
  assert.equal(accepted.decisions,1);assert.deepEqual(transitions,['accepted']);
  assert.equal(published.at(-1)?.items[0].available,1);
  assert.equal((await update('rejected')).statusCode,200);
  assert.equal((await update('rejected')).json().idempotent,true);
  await syncMarketplaceStore(db,store,transport);
  assert.deepEqual(transitions,['accepted','rejected']);
  assert.equal((await db.query('SELECT reserved FROM stock_balances WHERE store_id=$1 AND variant_id=$2',[store,variant])).rows[0].reserved,'0');
  assert.equal((await db.query('SELECT count(*)::int AS total FROM marketplace_orders WHERE store_id=$1',[store])).rows[0].total,1);
  assert.deepEqual(await syncMarketplaceStore(db,another,transport),{disabled:true,received:0,decisions:0,published:0});
 }finally{
  await app.close();await db.end();
  process.env.LOJA_SYNC_SECRET_DIR=previous;
  await rm(folder,{recursive:true,force:true});
 }
});
