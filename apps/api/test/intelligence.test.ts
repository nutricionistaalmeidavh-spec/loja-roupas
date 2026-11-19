import {test} from 'node:test';
import assert from 'node:assert/strict';
import {forecast28Days} from '../src/intelligence.ts';

test('projeção de 14 dias considera devoluções e informa a faixa das duas quinzenas',()=>{
  const series=Array.from({length:28},(_,day)=>({
    period:String(day),gross_cents:day<14?'1000':'2000',refunded_cents:day===14?'3000':'0',
  }));
  assert.deepEqual(forecast28Days(series),{
    method:'trailing_28_days',active_days:28,estimate_cents:'19500',low_cents:'14000',high_cents:'25000',
  });
});

test('sem sete dias de vendas, a previsão fica indisponível',()=>{
  const series=Array.from({length:28},(_,day)=>({
    period:String(day),gross_cents:day<6?'1000':'0',refunded_cents:'0',
  }));
  assert.equal(forecast28Days(series).estimate_cents,null);
});
