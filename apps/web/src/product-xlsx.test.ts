import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProductSheetRows } from './product-xlsx.ts';

const header=['produto','categoria','sku','cor','tamanho','preco','codigo_barras','estoque_inicial'];

test('XLSX: aceita numero de preço e agrupa cor/tamanho mantendo barcode texto',()=>{
 const parsed=parseProductSheetRows([header,
  ['Vestido midi','Feminino','VEST-P','Preto','P',149.9,'00012345',4],
  ['Vestido midi','Feminino','VEST-M','Preto','M',149.9,null,6]]);
 assert.deepEqual(parsed.issues,[]);
 assert.equal(parsed.products.length,1);
 assert.equal(parsed.rows,2);
 assert.equal(parsed.products[0].variants[0].price_cents,14990);
 assert.equal(parsed.products[0].variants[0].barcode,'00012345');
 assert.equal(parsed.products[0].variants[1].initial_stock,6);
});

test('XLSX: nao permite perder zeros de codigos de barras numericos',()=>{
 const parsed=parseProductSheetRows([header,['Jaqueta','Masculino','JAQ-P','Azul','P',200,123456789,0]]);
 assert.ok(parsed.issues.some(e=>e.line===2&&/texto/i.test(e.message)));
});

test('XLSX: detecta preco fracionado indevido e impede arredondamento silencioso',()=>{
 const parsed=parseProductSheetRows([header,['Saia','Feminino','SAI-M','Branco','M',10.999,null,0]]);
 assert.ok(parsed.issues.length>0);
});

test('XLSX: rejeita cabecalho incorreto e valores de tipo inesperado',()=>{
 assert.match(parseProductSheetRows([['produto','sku']]).issues[0].message,/Cabeçalho/);
 const parsed=parseProductSheetRows([header,['Saia','Feminino','SAI-P','Branco','P',true,null,2]]);
 assert.ok(parsed.issues.length>0);
});

test('XLSX: conteudo textual com virgulas e aspas nao quebra colunas',()=>{
 const parsed=parseProductSheetRows([header,['Camisa, "premium"','Unissex','CAM-Z','Azul','G','100,50',null,0]]);
 assert.deepEqual(parsed.issues,[]);
 assert.equal(parsed.products[0].name,'Camisa, "premium"');
});
