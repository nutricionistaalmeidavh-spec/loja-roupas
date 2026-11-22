import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOperatingExpense,calculateOperatingResult} from '../src/physical-finance.ts';

test('despesa exige reais inteiros em centavos, categoria, motivo e data local',()=>{
 const expense=validateOperatingExpense({amount_cents:9900,category:'Aluguel',description:'Aluguel novembro',occurred_on:'2026-11-22'});
 assert.equal(expense.amount_cents,9900);
 assert.equal(expense.occurred_on,'2026-11-22');
 for(const amount of [-1,0,1.5,Number.MAX_SAFE_INTEGER+1])
  assert.throws(()=>validateOperatingExpense({amount_cents:amount,category:'Aluguel',description:'Aluguel',occurred_on:'2026-11-22'}));
 assert.throws(()=>validateOperatingExpense({amount_cents:100,category:'',description:'Teste',occurred_on:'2026-11-22'}));
 assert.throws(()=>validateOperatingExpense({amount_cents:100,category:'Teste',description:'Teste',occurred_on:'2026-02-30'}));
});
test('resultado operacional distingue faturamento, devoluções e despesas',()=>{
 const r=calculateOperatingResult({gross_cents:100000,refunds_cents:8000,expenses_cents:12000});
 assert.deepEqual(r,{gross_cents:100000,refunds_cents:8000,expenses_cents:12000,net_sales_cents:92000,operational_balance_cents:80000});
});
