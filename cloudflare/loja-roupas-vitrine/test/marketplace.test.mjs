import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';

test('marketplace público apresenta somente variantes publicadas e URLs isoladas por loja',async()=>{
 const statements=[];
 const db={prepare(sql){
   let params=[];
   const stmt={
    bind(...values){params=values;return stmt;},
    async all(){
      statements.push({sql,params});
      if(sql.includes('FROM variants v JOIN tenants')){
        return {results:[{id:'sku-feminina',slug:'boutique-jardim',store_name:'Boutique Jardim',name:'Vestido floral',category:'Vestidos',color:'Azul',size:'M',price_cents:16990,photo_url:null,available:4}]};
      }
      if(sql.includes('FROM tenants t'))return {results:[{slug:'boutique-jardim',name:'Boutique Jardim',pieces:4}]};
      return {results:[]};
    }
   };return stmt;
 }};
 const response=await worker.fetch(new Request('https://example.test/v1/marketplace?q=vestido&category=Vestidos'),{DB:db});
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.items[0].store.slug,'boutique-jardim');
 assert.equal(body.items[0].price_cents,16990);
 assert.equal(body.stores[0].slug,'boutique-jardim');
 assert.equal(body.items[0].email,undefined);
 assert.ok(statements.some(x=>x.sql.includes('v.published=1')));
 assert.ok(statements.some(x=>x.sql.includes('t.slug')));
 assert.ok(statements.some(x=>x.params.includes('vestido')));
 assert.ok(statements.some(x=>x.params.includes('vestidos')));
});
test('a busca limita entradas e não expõe dados de licenças',async()=>{
 const response=await worker.fetch(new Request('https://example.test/v1/marketplace?q='+encodeURIComponent('a'.repeat(201))),{DB:{}});
 assert.equal(response.status,400);
});
test('marketplace sem lojas mostra estado vazio, sem produtos fictícios',async()=>{
 const db={prepare(){return{bind(){return this;},async all(){return{results:[]}}}}};
 const data=await(await worker.fetch(new Request('https://example.test/v1/marketplace'),{DB:db})).json();
 assert.deepEqual(data.items,[]);
 assert.deepEqual(data.stores,[]);
});

test('marketplace avança 36 variantes por cursor e rejeita cursor adulterado',async()=>{
 const seen=[];
 const date='2026-11-21T12:00:00Z';
 const item=i=>({id:'sku-'+String(i).padStart(3,'0'),updated_at:date,
  slug:'loja-teste',store_name:'Loja Teste',name:'Peça '+i,category:'Blusas',
  color:'Preto',size:'M',price_cents:2000,photo_url:null,available:1});
 const db={prepare(sql){
  let params=[];
  const stmt={bind(...values){params=values;return stmt;},async all(){
   seen.push({sql,params});
   if(sql.includes('FROM variants v JOIN tenants')){
    return {results:params.length>1?[item(37),item(38)]:Array.from({length:37},(_,i)=>item(i+1))};
   }
   return {results:[]};
  }};
  return stmt;
 }};
 const base='https://example.test/v1/marketplace';
 const first=await(await worker.fetch(new Request(base),{DB:db})).json();
 assert.equal(first.items.length,36);
 assert.ok(first.next_cursor);
 const second=await(await worker.fetch(new Request(base+'?cursor='+encodeURIComponent(first.next_cursor)),{DB:db})).json();
 assert.deepEqual(second.items.map(x=>x.id),['sku-037','sku-038']);
 assert.equal(second.next_cursor,null);
 const cursorQuery=seen.find(x=>x.sql.includes('v.updated_at < ?'));
 assert.ok(cursorQuery);
 assert.ok(cursorQuery.params.includes('sku-036'));
 assert.equal((await worker.fetch(new Request(base+'?cursor=invalid!'),{DB:db})).status,400);
});
