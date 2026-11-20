import test from 'node:test';
import assert from 'node:assert/strict';
import {CSV_TEMPLATE,parseProductCsv} from './product-import.ts';
test('template agrupa combinações de cores e tamanhos e mantém estoque',()=>{
 const result=parseProductCsv(CSV_TEMPLATE);
 assert.deepEqual(result.errors,[]);
 assert.equal(result.products.length,2);
 assert.equal(result.rows.length,3);
 assert.equal(result.products[0].variants.length,2);
 assert.equal(result.rows[0].price_cents,14990);
 assert.equal(result.rows[0].initial_stock,4);
});
test('falha em SKU repetido, preço e estoque inválidos',()=>{
 const bad=['produto;categoria;sku;cor;tamanho;preco;codigo_barras;estoque_inicial',
  'Camisa;Feminino;DUP;Azul;P;120,00;;2',
  'Camisa;Feminino;DUP;Azul;M;120,00;;3',
  'Vestido;Feminino;VES;Preto;M;abc;;-1'].join('\n');
 const result=parseProductCsv(bad);
 assert.equal(result.errors.length,2);
 assert.match(result.errors[0],/Linha 3/);
 assert.match(result.errors[1],/Linha 4/);
});
test('permite aspas, vírgulas decimais e BOM',()=>{
 const csv='\uFEFF'+['produto;categoria;sku;cor;tamanho;preco;codigo_barras;estoque_inicial',
 '"Camisa; Social";Unissex;SOC-001;Azul;G;1.234,50;001234;0'].join('\r\n');
 const result=parseProductCsv(csv);
 assert.equal(result.errors.length,0);
 assert.equal(result.rows[0].name,'Camisa; Social');
 assert.equal(result.rows[0].price_cents,123450);
 assert.equal(result.rows[0].barcode,'001234');
});
test('bloqueia CSV sem cabeçalho ou acima de 300 linhas',()=>{
 assert.ok(parseProductCsv('qualquer;coisa\n').errors.length>0);
 const lines=['produto;categoria;sku;cor;tamanho;preco'];
 for(let i=0;i<301;i++)lines.push('Camisa;Feminino;SKU'+i+';Azul;M;10,00');
 assert.match(parseProductCsv(lines.join('\n')).errors[0],/300/);
});
