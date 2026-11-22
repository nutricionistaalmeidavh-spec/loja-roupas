import test from 'node:test';
import assert from 'node:assert/strict';
import {creditInstallments,exchangeBalance,commissionCents,loyaltyPoints,dreTotals,settlementAllowed} from '../src/retail-rules.ts';
test('parcelas do crediário devem somar exatamente o principal e ter vencimentos válidos',()=>{
 assert.deepEqual(creditInstallments(20000,[{amount_cents:10000,due_on:'2026-12-01'},{amount_cents:10000,due_on:'2027-01-01'}]),
  [{amount_cents:10000,due_on:'2026-12-01'},{amount_cents:10000,due_on:'2027-01-01'}]);
 assert.throws(()=>creditInstallments(20000,[{amount_cents:19999,due_on:'2026-12-01'}]),/parcelas|soma/i);
 assert.throws(()=>creditInstallments(10000,[{amount_cents:10000,due_on:'2026-02-30'}]),/data/i);
});
test('troca calcula diferença positiva e crédito não negativo sem arredondamento',()=>{
 assert.deepEqual(exchangeBalance(10000,13000),{extra_due_cents:3000,credit_cents:0,exchange_payment_cents:10000});
 assert.deepEqual(exchangeBalance(12000,9000),{extra_due_cents:0,credit_cents:3000,exchange_payment_cents:9000});
});
test('comissão limitada e fidelidade em centavos inteiros',()=>{
 assert.equal(commissionCents(12990,500),649);
 assert.equal(loyaltyPoints(12990),129);
 assert.throws(()=>commissionCents(1000,10001),/taxa/i);
});
test('DRE não trata custos históricos desconhecidos como lucro comprovado',()=>{
 assert.deepEqual(dreTotals({gross_cents:100000,returns_cents:10000,cost_cents:40000,
  expenses_cents:20000,commissions_cents:5000,tax_cents:5000,unknown_cost_lines:2}),{
  net_revenue_cents:90000,gross_profit_cents:50000,operating_result_cents:20000,
  complete:false,unknown_cost_lines:2
 });
});
test('liquidação parcial nunca excede saldo aberto',()=>{
 assert.equal(settlementAllowed(10000,6000,4000),4000);
 assert.throws(()=>settlementAllowed(10000,6000,4001),/saldo/i);
});
