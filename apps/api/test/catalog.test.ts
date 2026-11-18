import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import type { Pool } from 'pg';
const store='79a43ea3-ff29-4b7c-b7e8-9c78fe139e30';
const token='z'.repeat(43);
test('catálogo bloqueia acesso sem sessão e filtra por loja no SQL',async()=>{
  const queries:{sql:string;params?:unknown[]}[]=[];
  const db={query:async(sql:string,params?:unknown[])=>{
    queries.push({sql,params});
    if(sql.includes('FROM auth_sessions s'))return {rowCount:1,rows:[{user_id:'u',store_id:store,roles:['manager']}]};
    if(sql.includes('SELECT p.id::text AS product_id'))return {rowCount:1,rows:[{
      product_id:'p',name:'Blusa',category:'Feminino',variant_id:'v',sku:'BL-M',barcode:null,
      color:'Azul',size:'M',price_cents:'14990',available:'3'
    }]};
    return {rowCount:0,rows:[]};
  }};
  const app=buildApp(db as unknown as Pool);
  assert.equal((await app.inject('/v1/catalog/products')).statusCode,401);
  const r=await app.inject({url:'/v1/catalog/products?query=Blusa',headers:{authorization:`Bearer ${token}`,'x-store-id':store}});
  assert.equal(r.statusCode,200);
  assert.equal(r.json().items[0].variants[0].available,3);
  const query=queries.find(x=>x.sql.includes('SELECT DISTINCT p0.id'));
  assert.equal(query?.params?.[0],store);
  assert.equal(query?.params?.[1],'Blusa');
  await app.close();
});
