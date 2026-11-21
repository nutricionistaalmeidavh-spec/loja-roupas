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

test('marketplace pagina por data e ID sem repetir a primeira página de 36 peças',async()=>{
 const seen=[];
 const all=Array.from({length:37},(_,i)=>({
  id:'piece-'+String(i+1).padStart(3,'0'),slug:'loja-um',store_name:'Loja Um',
  updated_at:'2026-11-21 19:00:00',name:'Camisa',category:'Camisas',color:'Azul',size:'M',
  price_cents:3500,available:2,photo_url:null
 }));
 const db={prepare(sql){
  let args=[];
  const stmt={bind(...v){args=v;return stmt;},async all(){
   seen.push({sql,args});
   if(sql.includes('FROM variants v JOIN tenants'))return {results:all};
   return {results:[]};
  }};return stmt;
 }};
 const first=await(await worker.fetch(new Request('https://example.test/v1/marketplace'),{DB:db})).json();
 assert.equal(first.items.length,36);
 assert.ok(first.next_cursor);
 assert.equal(seen[0].args.at(-1),37);
 const second=await(await worker.fetch(new Request('https://example.test/v1/marketplace?after='+encodeURIComponent(first.next_cursor)),{DB:db})).json();
 assert.equal(second.items.length,36);
 const withAfter=seen.find(x=>x.sql.includes('v.updated_at < ?'));
 assert.ok(withAfter);
 assert.deepEqual(withAfter.args.slice(0,3),['2026-11-21 19:00:00','2026-11-21 19:00:00','piece-036']);
});
test('cursor público malformado é rejeitado sem consulta ao banco',async()=>{
 const response=await worker.fetch(new Request('https://example.test/v1/marketplace?after=invalid_cursor'),{DB:{}});
 assert.equal(response.status,400);
 assert.equal((await response.json()).error,'invalid_cursor');
});
