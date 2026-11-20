import test from 'node:test';import assert from 'node:assert/strict';
import worker,{normalizeSlug,normalizeStockItem,validateOrder} from '../worker.mjs';
test('slug e estoque são validados antes de gravar',()=>{
 assert.equal(normalizeSlug('Minha Loja'),'minha-loja');
 assert.equal(normalizeSlug('../admin'),null);
 assert.equal(normalizeStockItem({id:'sku-01',product_id:'p-01',name:'Blusa',price_cents:2990,revision:2,available:3,published:true}).available,3);
 assert.throws(()=>normalizeStockItem({id:'x',product_id:'p',name:'A',price_cents:-1,revision:1,available:1,published:true}));
});
test('pedido não confirma estoque nem permite quantidades inválidas',()=>{
 assert.deepEqual(validateOrder({request_id:'ord-11111',customer_name:'Cliente',lines:[{variant_id:'sku-01',quantity:1}]}).lines,[{variant_id:'sku-01',quantity:1}]);
 assert.throws(()=>validateOrder({request_id:'ord-12345',customer_name:'Cliente',lines:[{variant_id:'sku-01',quantity:0}]}));
});
test('rotas administrativas não ficam públicas',async()=>{
 const request=new Request('https://loja.test/v1/admin/tenants',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({slug:'teste'})});
 const r=await worker.fetch(request,{DB:{},PLATFORM_ADMIN_TOKEN:'valid-token'});
 assert.equal(r.status,401);
});
test('health sem dados pessoais e sem dependência paga',async()=>{
 const r=await worker.fetch(new Request('https://loja.test/health'),{});
 assert.deepEqual(await r.json(),{ok:true,service:'loja-roupas-vitrine',version:1});
});
