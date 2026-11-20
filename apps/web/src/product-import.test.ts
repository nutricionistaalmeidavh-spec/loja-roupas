import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProductCsv, PRODUCT_CSV_TEMPLATE } from './product-import.ts';

test('modelo oficial CSV cria grupos por produto e estoque por tamanho',()=>{
  const parsed=parseProductCsv(PRODUCT_CSV_TEMPLATE);
  assert.deepEqual(parsed.issues,[]);
  assert.equal(parsed.products.length,2);
  assert.equal(parsed.rows,3);
  assert.equal(parsed.products[0].variants.length,2);
  assert.equal(parsed.products[0].variants[0].price_cents,14990);
  assert.equal(parsed.products[0].variants[1].initial_stock,6);
});

test('suporta CSV entre aspas, delimitador e vírgula em preços',()=>{
  const csv='produto;categoria;sku;cor;tamanho;preco;codigo_barras;estoque_inicial\n'+
    '"Camisa; premium";Feminino;ABC01;Areia;M;1.299,50;000123456;0\n';
  const parsed=parseProductCsv(csv);
  assert.equal(parsed.products[0].name,'Camisa; premium');
  assert.equal(parsed.products[0].variants[0].price_cents,129950);
  assert.equal(parsed.products[0].variants[0].barcode,'000123456');
});

test('bloqueia SKU duplicado mesmo entre peças distintas',()=>{
  const parsed=parseProductCsv('produto;categoria;sku;cor;tamanho;preco;codigo_barras;estoque_inicial\n'+
    'Camisa;Feminino;SKU1;Azul;M;10,00;;1\n'+
    'Vestido;Feminino;SKU1;Preto;P;20,00;;2\n');
  assert.equal(parsed.issues.length,1);
  assert.match(parsed.issues[0].message,/SKU duplicado/);
});

test('bloqueia combinação de tamanho e cor repetida',()=>{
  const parsed=parseProductCsv('produto;categoria;sku;cor;tamanho;preco;codigo_barras;estoque_inicial\n'+
    'Camisa;Feminino;SKU1;Azul;M;10,00;;0\n'+
    'Camisa;Feminino;SKU2;azul;m;11,00;;0\n');
  assert.equal(parsed.issues.length,1);
  assert.match(parsed.issues[0].message,/Cor e tamanho duplicados/);
});

test('detecta cabeçalho alterado, valores negativos e planilha vazia',()=>{
  assert.equal(parseProductCsv('').issues.length,1);
  assert.match(parseProductCsv('produto;sku\nCamisa;123').issues[0].message,/Cabeçalho/);
  const csv='produto;categoria;sku;cor;tamanho;preco;codigo_barras;estoque_inicial\n'+
    'Camisa;Feminino;SKU1;Azul;M;-10,00;;-2\n';
  assert.equal(parseProductCsv(csv).issues.length,1);
});

test('invalida CSV com aspas pendentes e ignora linhas vazias',()=>{
  const header='produto;categoria;sku;cor;tamanho;preco;codigo_barras;estoque_inicial\n';
  assert.match(parseProductCsv(header+'"Camisa').issues[0].message,/aspas/);
  assert.equal(parseProductCsv(header+'\nCamisa;Feminino;ABC;Azul;M;0;;0\n\n').rows,1);
});
