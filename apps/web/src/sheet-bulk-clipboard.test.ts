import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBulkClipboard,buildBulkClipboard} from './sheet-bulk-clipboard.ts';

const items=[
 {variant_id:'v1',product_id:'p1',name:'Camisa',category:'Feminino',sku:'CAM-P',color:'Azul',size:'P',barcode:null,price_cents:10000,product_revision:2,variant_revision:3},
 {variant_id:'v2',product_id:'p1',name:'Camisa',category:'Feminino',sku:'CAM-M',color:'Azul',size:'M',barcode:'000123',price_cents:10000,product_revision:2,variant_revision:1},
 {variant_id:'v3',product_id:'p2',name:'Calça',category:'Masculino',sku:'CAL-42',color:'Preto',size:'42',barcode:null,price_cents:18990,product_revision:1,variant_revision:1}
];

test('P2: modelo TSV preserva codigo de barras com zeros e valores brasileiros',()=>{
 const text=buildBulkClipboard(items);
 assert.match(text,/000123/);
 assert.match(text,/189,90/);
 const result=parseBulkClipboard(text,items);
 assert.deepEqual(result.issues,[]);
 assert.equal(result.updates.length,0);
});

test('P2: aceita colar multiplos produtos, atualiza somente linhas modificadas',()=>{
 const text=buildBulkClipboard(items).replace('100,00','109,90').replace('CAL-42\tCAL-42','CAL-42\tCAL-43');
 const result=parseBulkClipboard(text,items);
 assert.deepEqual(result.issues,[]);
 assert.equal(result.updates.length,2);
 assert.equal(result.updates[0].price_cents,10990);
 assert.equal(result.updates[1].sku,'CAL-43');
 assert.equal(result.updates[0].expected_variant_revision,3);
});

test('P2: bloqueia campo SKU desconhecido, duplicado e colunas de estoque',()=>{
 const text=buildBulkClipboard(items);
 assert.ok(parseBulkClipboard(text.replace('CAM-P\tCAM-P','NOPE\tNOPE'),items).issues.some(x=>/desconhecido/.test(x.message)));
 assert.ok(parseBulkClipboard(text.replace('CAM-P\tCAM-P','CAM-P\tCAM-M'),items).issues.some(x=>/duplicado/.test(x.message)));
 assert.ok(parseBulkClipboard(text.replace('Preço (R$)','Saldo'),items).issues.length>0);
});

test('P2: nao altera nome/categoria divergente entre variantes do mesmo produto',()=>{
 const text=buildBulkClipboard(items).replace('CAM-P\tCAM-P\tCamisa','CAM-P\tCAM-P\tOutra');
 const result=parseBulkClipboard(text,items);
 assert.ok(result.issues.some(x=>/mesmo produto/.test(x.message)));
});

test('P2: rejeita formulas Excel, numeros negativos e dados incompletos',()=>{
 const text=buildBulkClipboard(items);
 assert.ok(parseBulkClipboard(text.replace('100,00','=1+2'),items).issues.length>0);
 assert.ok(parseBulkClipboard(text.replace('100,00','-1,00'),items).issues.length>0);
 assert.ok(parseBulkClipboard(text.replace('\tAzul\tP','\t\tP'),items).issues.length>0);
});

test('P2: rejeita blocos de copiar/colar acima de 100 linhas',()=>{
 const rows=buildBulkClipboard(items).split('\n');
 assert.ok(parseBulkClipboard([rows[0],...Array(101).fill(rows[1])].join('\n'),items).issues.some(x=>/100/.test(x.message)));
});
