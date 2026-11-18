import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { Pool } from 'pg';
import { buildApp } from '../src/app.ts';
import { hashPassword,issueSession } from '../src/security.ts';

const url=process.env.TEST_DATABASE_URL;
test('M2: ampliar e editar grade; gerar miniatura WebP sem CDN', {skip:!url&&'Exige PostgreSQL'}, async()=>{
 const db=new Pool({connectionString:url!}), app=buildApp(db);
 try{
  const st=await db.query<{id:string}>("INSERT INTO stores(name) VALUES('M2 Grade') RETURNING id::text");
  const storeId=st.rows[0].id;
  const u=await db.query<{id:string}>("INSERT INTO users(login,password_hash) VALUES($1,$2) RETURNING id::text",
   ['grade-'+randomUUID(),await hashPassword('Senha-Grade-2026!!')]);
  await db.query("INSERT INTO user_store_roles(user_id,store_id,role_code) VALUES($1,$2,'manager')",[u.rows[0].id,storeId]);
  const {token,tokenHash}=issueSession();
  await db.query("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')",[u.rows[0].id,tokenHash]);
  const headers={authorization:'Bearer '+token,'x-store-id':storeId};
  const write=()=>({...headers,'idempotency-key':randomUUID()});
  const p=await app.inject({method:'POST',url:'/v1/catalog/products',headers:write(),payload:{
   name:'Blazer',category:'Feminino',variants:[{sku:'BLZ-'+randomUUID().slice(0,6),color:'Bege',size:'M',price_cents:30000}]
  }});
  assert.equal(p.statusCode,201,p.body);
  const productId=p.json().id;
  const anotherSku='BLZ-'+randomUUID().slice(0,6);
  const added=await app.inject({method:'POST',url:'/v1/catalog/products/'+productId+'/variants',
    headers:write(),payload:{sku:anotherSku,color:'Bege',size:'G',price_cents:31500,expected_product_revision:1}});
  assert.equal(added.statusCode,201,added.body);
  assert.equal(added.json().revision,1);
  const renamedSku='BLZ-'+randomUUID().slice(0,6);
  const edited=await app.inject({method:'PATCH',url:'/v1/catalog/variants/'+added.json().id+'/attributes',
    headers:write(),payload:{sku:renamedSku,color:'Areia',size:'G',barcode:null,expected_revision:1}});
  assert.equal(edited.statusCode,200,edited.body);
  assert.equal(edited.json().revision,2);
  const stale=await app.inject({method:'PATCH',url:'/v1/catalog/variants/'+added.json().id+'/attributes',
    headers:write(),payload:{sku:'ST-'+randomUUID().slice(0,6),color:'Preto',size:'P',expected_revision:1}});
  assert.equal(stale.statusCode,409);
  const png=await sharp({create:{width:800,height:1000,channels:3,background:'#DDCCBB'}}).png().toBuffer();
  const uploaded=await app.inject({method:'PUT',url:'/v1/catalog/products/'+productId+'/photo',
    headers:{...write(),'content-type':'image/png'},payload:png});
  assert.equal(uploaded.statusCode,200,uploaded.body);
  const thumb=await app.inject({url:'/v1/catalog/products/'+productId+'/thumbnail',headers});
  assert.equal(thumb.statusCode,200,thumb.body);
  assert.equal(thumb.headers['content-type'],'image/webp');
  assert.ok(thumb.rawPayload.length<png.length);
  const meta=await sharp(thumb.rawPayload).metadata();
  assert.ok((meta.width??0)<=480&&(meta.height??0)<=640);
  const catalog=await app.inject({url:'/v1/catalog/products?query=Blazer',headers});
  assert.equal(catalog.statusCode,200,catalog.body);
  const product=catalog.json().items.find((x:{id:string})=>x.id===productId);
  assert.equal(product.variants.length,2);
  assert.equal(product.variants.find((x:{id:string})=>x.id===added.json().id).sku,renamedSku);
 } finally {await app.close();await db.end();}
});
