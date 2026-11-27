import test from 'node:test';
import assert from 'node:assert/strict';
import {allocateDiscounts,lineRefundCents} from '../src/retail-rules.ts';
import {suggestRefund} from '../src/refunds.ts';

test('desconto geral é repartido entre as linhas sem perder centavos',()=>{
 const lines=[{gross_cents:10000,discount_cents:0},{gross_cents:5000,discount_cents:1000},{gross_cents:333,discount_cents:0}];
 const out=allocateDiscounts(lines,1001);
 assert.equal(out.reduce((a,b)=>a+b,0),1000+1001);
 assert.ok(out.every((d,i)=>d<=lines[i].gross_cents));
 assert.equal(out[1]>=1000,true);
 assert.deepEqual(allocateDiscounts([{gross_cents:100,discount_cents:0}],0),[0]);
 assert.throws(()=>allocateDiscounts([{gross_cents:100,discount_cents:101}],0),/maior/);
 assert.throws(()=>allocateDiscounts([{gross_cents:100,discount_cents:50}],51),/maior/);
});

test('devolução parcial devolve o valor pago, e a última unidade leva o resto',()=>{
 // 3 peças por R$ 100,00 no total (com desconto): 33,33 + 33,33 + 33,34.
 assert.equal(lineRefundCents(10000,3,0,1),3333);
 assert.equal(lineRefundCents(10000,3,1,1),3333);
 assert.equal(lineRefundCents(10000,3,2,1),3334);
 assert.equal(lineRefundCents(10000,3,0,3),10000);
 assert.throws(()=>lineRefundCents(10000,3,2,2),/Quantidade/);
});

test('sugestão de reembolso abate crediário antes de devolver dinheiro',()=>{
 const refundable={store_credit:3000,customer_credit:0,card_external:0,pix_manual:2000,cash:5000};
 assert.deepEqual(suggestRefund(6000,refundable),[
  {method:'store_credit',amount_cents:3000},{method:'pix_manual',amount_cents:2000},{method:'cash',amount_cents:1000}]);
 assert.throws(()=>suggestRefund(20000,refundable),/excede/);
});
