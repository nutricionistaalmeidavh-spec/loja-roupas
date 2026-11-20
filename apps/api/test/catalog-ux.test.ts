import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { buildApp } from '../src/app.ts';

const store='79a43ea3-ff29-4b7c-b7e8-9c78fe139e30';
const variant='82df5fca-2c59-49f7-8ac8-38cd1996c229';
const token='z'.repeat(43);
const headers={authorization:'Bearer '+token,'x-store-id':store};

test('categorias vêm do servidor, inclusive produtos fora da primeira página',async()=>{
 const calls:Array<{sql:string;params?:unknown[]}>= [];
 const db={query:async(sql:string,params?:unknown[])=>{
   calls.push({sql,params});
   if(sql.includes('FROM auth_sessions s'))return {rowCount:1,rows:[{user_id:'u',store_id:store,roles:['manager']}]};
   if(sql.includes('SELECT DISTINCT category'))return {rows:[{category:'Acessórios'},{category:'Masculino'}]};
   return {rows:[],rowCount:0};
 }};
 const app=buildApp(db as unknown as Pool);
 try{
   assert.equal((await app.inject('/v1/catalog/categories')).statusCode,401);
   const response=await app.inject({url:'/v1/catalog/categories',headers});
   assert.equal(response.statusCode,200,response.body);
   assert.deepEqual(response.json(),{categories:['Acessórios','Masculino']});
   assert.equal(calls.find(c=>c.sql.includes('SELECT DISTINCT category'))?.params?.[0],store);
 }finally{await app.close();}
});

test('variantes salvas são recuperadas diretamente por ID e sempre com escopo da loja',async()=>{
 const calls:Array<{sql:string;params?:unknown[]}>= [];
 const db={query:async(sql:string,params?:unknown[])=>{
   calls.push({sql,params});
   if(sql.includes('FROM auth_sessions s'))return {rowCount:1,rows:[{user_id:'u',store_id:store,roles:['manager']}]};
   if(sql.includes('WHERE v.store_id=$1')&&sql.includes('v.id = ANY'))return {rows:[{
    product_id:'b7e0c449-1029-48c3-9d6f-7adf99f00d72',
    name:'Camisa recuperada',category:'Masculino',product_revision:'1',has_photo:false,
    variant_id:variant,sku:'CAM-AZ-G',barcode:null,color:'Azul',size:'G',
    price_cents:'12990',available:'2',revision:'5',variant_revision:'2'
   }]};
   return {rows:[],rowCount:0};
 }};
 const app=buildApp(db as unknown as Pool);
 try{
   const path='/v1/catalog/draft-variants?ids='+variant;
   assert.equal((await app.inject(path)).statusCode,401);
   const response=await app.inject({url:path,headers});
   assert.equal(response.statusCode,200,response.body);
   const item=response.json().items[0];
   assert.equal(item.variants[0].id,variant);
   assert.equal(item.variants[0].price_cents,12990);
   assert.equal(item.variants[0].available,2);
   const lookup=calls.find(c=>c.sql.includes('v.id = ANY'));
   assert.equal(lookup?.params?.[0],store);
   assert.deepEqual(lookup?.params?.[1],[variant]);
   assert.equal((await app.inject({url:'/v1/catalog/draft-variants?ids=invalid',headers})).statusCode,400);
 }finally{await app.close();}
});
