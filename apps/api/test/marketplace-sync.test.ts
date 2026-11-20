import test from 'node:test';import assert from 'node:assert/strict';
import {nextListingRevision,normalizeRemoteOrder,listingFingerprint,marketplaceBaseUrl,normalizeCloudStatus} from '../src/marketplace-sync-core.ts';

test('revisão monotônica e hash mudam com estoque mas não com relógio',()=>{
 const product={id:'fe8d5db3-2a0e-4c3b-ae7d-ac2d036da5df',product_id:'82e4da44-c815-4acc-b49a-b597af0a7cfa',name:'Vestido',category:'Feminino',color:'Azul',size:'M',price_cents:13000,available:2,published:true,photo_url:null};
 assert.equal(listingFingerprint(product),listingFingerprint({...product}));
 assert.notEqual(listingFingerprint(product),listingFingerprint({...product,available:0}));
 assert.ok(nextListingRevision(2000000000000,1900000000000)>2000000000000);
});
test('pedidos duplicados, quantidades anômalas e lojas cruzadas são rejeitados',()=>{
 const order={id:'c8b5b6a5-0b46-45ee-9afd-bba3f0ed143a',request_id:'online-request',customer_name:'Maria Silva',customer_phone:'',
  status:'pending',created_at:'2026-11-20T10:00:00.000Z',lines:[{variant_id:'8aa449a2-d9ce-4fed-9e12-691f83b0f771',quantity:2}]};
 assert.equal(normalizeRemoteOrder(order).lines[0].quantity,2);
 assert.throws(()=>normalizeRemoteOrder({...order,lines:[...order.lines,...order.lines]}));
 assert.throws(()=>normalizeRemoteOrder({...order,lines:[{...order.lines[0],quantity:0}]}));
 assert.throws(()=>normalizeRemoteOrder({...order,id:'../../etc/passwd'}));
});
test('endpoint seguro: HTTPS ou self-hosted explícito',()=>{
 assert.equal(marketplaceBaseUrl({}).origin,'https://loja-roupas-vitrine.sistema-artisys.workers.dev');
 assert.throws(()=>marketplaceBaseUrl({LOJA_MARKETPLACE_URL:'http://example.com'}));
 assert.equal(marketplaceBaseUrl({LOJA_MARKETPLACE_URL:'https://marketplace.interno.exemplo'}).origin,'https://marketplace.interno.exemplo');
});
test('transições remotas não liberam estoque antes do operador decidir',()=>{
 assert.equal(normalizeCloudStatus('accepted'),'accepted');
 assert.throws(()=>normalizeCloudStatus('cancelled'));
});
