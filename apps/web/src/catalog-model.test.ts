import test from 'node:test';
import assert from 'node:assert/strict';
import { mapCatalog, reaisToCents, productCanAdd, sortSizes } from './catalog-model.ts';

const product={
  id:'product-1',name:'Camisa de linho',category:'Feminino',
  variants:[
    {id:'variant-1',sku:'CAM-AZ-M',product_id:'product-1',color:'Azul',size:'M',price_cents:14990,available:4,revision:2,barcode:null},
    {id:'variant-2',sku:'CAM-AZ-G',product_id:'product-1',color:'Azul',size:'G',price_cents:14990,available:0,revision:0,barcode:null}
  ]
};
test('dados do PostgreSQL são adaptados ao carrinho por SKU e centavos, sem valores fictícios',()=>{
  const [mapped]=mapCatalog({items:[product],next_cursor:null});
  assert.equal(mapped.variants[0].priceCents,14990);
  assert.equal(mapped.variants[0].available,4);
  assert.equal(mapped.variants[0].sku,'CAM-AZ-M');
  assert.equal(mapped.category,'Feminino');
  assert.equal(productCanAdd(mapped.variants[0]),true);
  assert.equal(productCanAdd(mapped.variants[1]),false);
});
test('valor monetário do servidor inválido não vira preço no frontend',()=>{
  assert.throws(()=>mapCatalog({items:[{...product,variants:[{...product.variants[0],price_cents:12.5}]}],next_cursor:null}),/preço|valor/i);
  assert.throws(()=>mapCatalog({items:[{...product,variants:[{...product.variants[0],available:-1}]}],next_cursor:null}),/estoque|saldo/i);
});
test('entrada BRL converte inteiros e vírgula a centavos sem float arbitrário',()=>{
  assert.equal(reaisToCents('149,90'),14990);
  assert.equal(reaisToCents('0,05'),5);
  assert.equal(reaisToCents('100'),10000);
  assert.equal(reaisToCents('1.299,90'),129990);
  assert.equal(reaisToCents('R$ 1.234,56'),123456);
  assert.equal(reaisToCents('1.234'),123400);
  assert.equal(reaisToCents('100.00'),10000);
  assert.equal(reaisToCents('1.20'),120);
  assert.equal(reaisToCents('12.5'),1250);
  for(const bad of ['1.29,90','12.34.5','-2,00','10,999','1,234.56','','a10'])
    assert.throws(()=>reaisToCents(bad));
});

test('fallback de moda não inventa uma camiseta para vestido, saia ou categoria não identificada',()=>{
 for(const [name,kind] of [['Vestido midi','dress'],['Saia evasê','skirt'],['Camisa de linho','shirt'],['Peça coleção autoral','generic']]){
   const [mapped]=mapCatalog({items:[{...product,name}],next_cursor:null});
   assert.equal(mapped.kind,kind);
 }
});

test('tamanhos seguem a ordem da grade, não a alfabética',()=>{
  assert.deepEqual(sortSizes(['G','P','GG','M','PP']),['PP','P','M','G','GG']);
  assert.deepEqual(sortSizes(['42','36','38','U']),['36','38','42','U']);
  assert.deepEqual(sortSizes(['Infantil','G','P']),['P','G','Infantil']);
});
