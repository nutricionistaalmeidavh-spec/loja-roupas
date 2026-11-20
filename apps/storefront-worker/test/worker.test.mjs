import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{normalizeSlug,validateBatch,validateOrder} from '../src/worker.mjs';

test('slug é canônico e não permite traversal ou domínio externo',()=>{
 assert.equal(normalizeSlug('  Boutique Exemplo  '),'boutique-exemplo');
 for(const value of ['../x','http://evil','x','foo/bar','a'.repeat(54)]){
  assert.equal(normalizeSlug(value),null);
 }
});
test('um batch contém até 50 variantes e números inteiros não negativos',()=>{
 const input={items:[{id:'52ef7f88-47b3-4144-9a74-78fd38636039',name:'Calça Jeans',sku:'CAL-01',color:'Azul',size:'M',category:'Calças',priceCents:12990,available:2,published:true,revision:1}]};
 assert.equal(validateBatch(input).length,1);
 assert.throws(()=>validateBatch({items:[{...input.items[0],available:-1}]}));
 assert.throws(()=>validateBatch({items:Array(51).fill(input.items[0])}));
 assert.throws(()=>validateBatch({items:[input.items[0],input.items[0]]}));
});
test('pedido é apenas solicitação e rejeita quantidades inválidas',()=>{
 const input={requestId:'a7375f0a-a95b-45d2-9d5a-797449dc2008',lines:[{variantId:'52ef7f88-47b3-4144-9a74-78fd38636039',quantity:1}]};
 assert.equal(validateOrder(input).lines[0].quantity,1);
 assert.throws(()=>validateOrder({...input,lines:[{...input.lines[0],quantity:0}]}));
 assert.throws(()=>validateOrder({...input,lines:Array(11).fill(input.lines[0])}));
});
test('sem tenants cadastrados a vitrine não vaza dados',async()=>{
 const env={DB:{prepare(){return{bind(){return{first:async()=>null}}}}}};
 assert.equal((await worker.fetch(new Request('https://worker.example/health'),env)).status,200);
 assert.equal((await worker.fetch(new Request('https://worker.example/v1/stores/boutique-inexistente/catalog'),env)).status,404);
 assert.equal((await worker.fetch(new Request('https://worker.example/v1/sync/orders?tenantId=abc'),env)).status,401);
});
