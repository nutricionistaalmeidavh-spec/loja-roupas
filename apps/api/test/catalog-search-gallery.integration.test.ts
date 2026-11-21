import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { Pool } from 'pg';
import { buildApp } from '../src/app.ts';
import { hashPassword,issueSession } from '../src/security.ts';

const connection=process.env.TEST_DATABASE_URL;
test('P0–P2: catálogo percorre todas as páginas e mantém foto principal + galeria auditada', {skip:!connection&&'Exige PostgreSQL isolado'}, async()=>{
 const db=new Pool({connectionString:connection!}), app=buildApp(db);
 try{
  const store=(await db.query<{id:string}>('INSERT INTO stores(name) VALUES($1) RETURNING id::text',['Paginação QA '+randomUUID()])).rows[0].id;
  const user=(await db.query<{id:string}>('INSERT INTO users(login,password_hash) VALUES($1,$2) RETURNING id::text',['catalog-'+randomUUID(),await hashPassword('Senha-Galeria-2026!!')])).rows[0].id;
  await db.query("INSERT INTO user_store_roles(user_id,store_id,role_code) VALUES($1,$2,'manager')",[user,store]);
  const {token,tokenHash}=issueSession();
  await db.query("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')",[user,tokenHash]);
  const headers={authorization:'Bearer '+token,'x-store-id':store};
  const authorized=(key=randomUUID())=>({...headers,'idempotency-key':key});
  const inserted=await db.query<{id:string}>(`INSERT INTO products(store_id,name,category)
   SELECT $1,'Camisa QA '||lpad(i::text,3,'0'),'Masculino'
   FROM generate_series(1,55) i RETURNING id::text`,[store]);
  await db.query(`INSERT INTO product_variants(store_id,product_id,sku,color,size,price_cents)
   SELECT $1,id,'QA-'||left(id::text,8),'Azul','M',11990 FROM products WHERE store_id=$1`,[store]);
  const first=await app.inject({url:'/v1/catalog/products?limit=50',headers});
  assert.equal(first.statusCode,200,first.body);
  assert.equal(first.json().items.length,50);
  assert.ok(first.json().next_cursor);
  const second=await app.inject({url:'/v1/catalog/products?limit=50&cursor='+encodeURIComponent(first.json().next_cursor),headers});
  assert.equal(second.statusCode,200,second.body);
  assert.equal(second.json().items.length,5);
  assert.equal(second.json().next_cursor,null);
  const ids=[...first.json().items,...second.json().items].map((p:{id:string})=>p.id);
  assert.equal(new Set(ids).size,55);
  const stockFirst=await app.inject({url:'/v1/stock/spreadsheet?limit=50',headers});
  assert.equal(stockFirst.statusCode,200,stockFirst.body);
  assert.equal(stockFirst.json().items.length,50);
  assert.ok(stockFirst.json().next_cursor);
  const stockSecond=await app.inject({url:'/v1/stock/spreadsheet?limit=50&cursor='+encodeURIComponent(stockFirst.json().next_cursor),headers});
  assert.equal(stockSecond.statusCode,200,stockSecond.body);
  assert.equal(stockSecond.json().items.length,5);
  assert.equal(stockSecond.json().next_cursor,null);
  assert.equal(new Set([...stockFirst.json().items,...stockSecond.json().items].map((x:{variant_id:string})=>x.variant_id)).size,55);
  const indexes=await db.query<{name:string}>("SELECT indexname AS name FROM pg_indexes WHERE schemaname='public' AND indexname LIKE 'catalog_%'");
  assert.ok(indexes.rows.some(x=>x.name==='catalog_products_name_trgm'));
  const selected=inserted.rows[0].id;
  const variant=(await db.query<{id:string}>('SELECT id::text FROM product_variants WHERE store_id=$1 AND product_id=$2',[store,selected])).rows[0].id;
  const original=await sharp({create:{width:400,height:500,channels:3,background:'#aabbcc'}}).png().toBuffer();
  const primary=await app.inject({method:'PUT',url:'/v1/catalog/products/'+selected+'/photo',headers:{...authorized(),'content-type':'image/png'},payload:original});
  assert.equal(primary.statusCode,200,primary.body);
  const photoCatalog=await app.inject({url:'/v1/catalog/products?query=QA&limit=50',headers});
  assert.ok(photoCatalog.json().items.find((p:{id:string})=>p.id===selected)?.photo_version);
  const gallery=await app.inject({method:'POST',url:'/v1/catalog/products/'+selected+'/photos?variant_id='+variant,
    headers:{...authorized(),'content-type':'image/png'},payload:original});
  assert.equal(gallery.statusCode,201,gallery.body);
  const photoId=gallery.json().id;
  const listing=await app.inject({url:'/v1/catalog/products/'+selected+'/photos',headers});
  assert.equal(listing.statusCode,200,listing.body);
  assert.equal(listing.json().items.length,2);
  assert.equal(listing.json().items[0].id,'primary');
  assert.equal(listing.json().items[1].variant_id,variant);
  const image=await app.inject({url:'/v1/catalog/products/'+selected+'/photos/'+photoId+'/thumbnail',headers});
  assert.equal(image.statusCode,200,image.body);
  assert.equal(image.headers['content-type'],'image/webp');
  const deleted=await app.inject({method:'DELETE',url:'/v1/catalog/products/'+selected+'/photos/'+photoId,headers:authorized()});
  assert.equal(deleted.statusCode,200,deleted.body);
  assert.equal((await app.inject({url:'/v1/catalog/products/'+selected+'/photos',headers})).json().items.length,1);
  const audit=await db.query<{n:string}>("SELECT count(*)::text AS n FROM audit_logs WHERE store_id=$1 AND action LIKE 'catalog.photo.%'",[store]);
  assert.ok(Number(audit.rows[0].n)>=3);
 }finally{await app.close();await db.end();}
});