import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import sharp from 'sharp';
import {buildApp} from '../src/app.ts';
import {hashPassword,issueSession} from '../src/security.ts';

test('P2 galeria real: mantém foto principal, vincula variante e audita inclusão/exclusão',{
 skip:!process.env.TEST_DATABASE_URL&&'Exige PostgreSQL de teste'
},async()=>{
 const db=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const app=buildApp(db);
 try{
  const store=(await db.query<{id:string}>('INSERT INTO stores(name) VALUES($1) RETURNING id::text',['Galeria P2 '+randomUUID()])).rows[0].id;
  const user=(await db.query<{id:string}>('INSERT INTO users(login,password_hash) VALUES($1,$2) RETURNING id::text',[
   'gallery-'+randomUUID(),await hashPassword('Teste-Galeria-2026')])).rows[0].id;
  await db.query("INSERT INTO user_store_roles(user_id,store_id,role_code) VALUES($1,$2,'manager')",[user,store]);
  const {token,tokenHash}=issueSession();
  await db.query("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')",[user,tokenHash]);
  const headers={authorization:'Bearer '+token,'x-store-id':store};
  const product=await app.inject({method:'POST',url:'/v1/catalog/products',
   headers:{...headers,'idempotency-key':randomUUID()},
   payload:{name:'Camisa de algodão',category:'Masculino',variants:[{
    sku:'GAL-'+randomUUID().slice(0,12).toUpperCase(),color:'Branco',size:'M',price_cents:12990}]}});
  assert.equal(product.statusCode,201,product.body);
  const id=product.json().id as string;
  const variant=product.json().variants[0].id as string;
  const png=await sharp({create:{width:48,height:48,channels:3,background:'#99AA55'}}).png().toBuffer();
  const png2=await sharp({create:{width:48,height:48,channels:3,background:'#55AA99'}}).png().toBuffer();
  const uploadMain=await app.inject({method:'PUT',url:'/v1/catalog/products/'+id+'/photo',
   headers:{...headers,'idempotency-key':randomUUID(),'content-type':'image/png'},payload:png});
  assert.equal(uploadMain.statusCode,200,uploadMain.body);
  const galleryKey=randomUUID();
  const upload=()=>app.inject({method:'POST',
   url:'/v1/catalog/products/'+id+'/gallery?variant_id='+variant,
   headers:{...headers,'idempotency-key':galleryKey,'content-type':'image/png'},payload:png2});
  const created=await upload();
  assert.equal(created.statusCode,201,created.body);
  const galleryId=created.json().id as string;
  assert.equal(created.json().position,1);
  assert.equal(created.json().variant_id,variant);
  const replay=await upload();
  assert.equal(replay.statusCode,201,replay.body);
  assert.equal(replay.json().id,galleryId);
  const list=await app.inject({url:'/v1/catalog/products/'+id+'/gallery',headers});
  assert.equal(list.statusCode,200,list.body);
  assert.deepEqual(list.json().items.map((p:{id:string})=>p.id),['primary',galleryId]);
  const hash=created.json().sha256 as string;
  const thumbnailPath='/v1/catalog/products/'+id+'/gallery/'+galleryId+'/thumbnail?v='+hash;
  const thumbnail=await app.inject({url:thumbnailPath,headers});
  assert.equal(thumbnail.statusCode,200,thumbnail.body);
  assert.equal(thumbnail.headers['content-type'],'image/webp');
  assert.match(String(thumbnail.headers['cache-control']),/private/);
  const unchanged=await app.inject({url:thumbnailPath,headers:{...headers,'if-none-match':'"'+hash+'"'}});
  assert.equal(unchanged.statusCode,304);
  const duplicate=await app.inject({method:'POST',url:'/v1/catalog/products/'+id+'/gallery',
   headers:{...headers,'idempotency-key':randomUUID(),'content-type':'image/png'},payload:png2});
  assert.equal(duplicate.statusCode,409,duplicate.body);
  const deleted=await app.inject({method:'DELETE',url:'/v1/catalog/products/'+id+'/gallery/'+galleryId,
   headers:{...headers,'idempotency-key':randomUUID()}});
  assert.equal(deleted.statusCode,200,deleted.body);
  const after=await app.inject({url:'/v1/catalog/products/'+id+'/gallery',headers});
  assert.deepEqual(after.json().items.map((p:{id:string})=>p.id),['primary']);
  const legacy=await app.inject({url:'/v1/catalog/products/'+id+'/photo',headers});
  assert.equal(legacy.statusCode,200);
  assert.equal(legacy.rawPayload.toString('hex'),png.toString('hex'));
  const audit=await db.query<{action:string}>(
   "SELECT action FROM audit_logs WHERE store_id=$1 AND aggregate_id=$2 AND action LIKE 'catalog.gallery.%' ORDER BY occurred_at",
   [store,id]);
  assert.deepEqual(audit.rows.map(x=>x.action).sort(),['catalog.gallery.add','catalog.gallery.delete']);
 }finally{await app.close();await db.end();}
});
