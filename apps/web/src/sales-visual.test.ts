import test from 'node:test';
import assert from 'node:assert/strict';
import {toSalesBars} from './sales-visual.ts';

test('gráfico de vendas usa somente séries reais, ordenadas e valores em centavos',()=>{
 const bars=toSalesBars([
  {day:'2026-11-20',sale_count:3,gross_cents:'25000',refunded_cents:'5000'},
  {day:'2026-11-19',sale_count:1,gross_cents:'10000',refunded_cents:'0'}
 ]);
 assert.deepEqual(bars.map(x=>x.day),['2026-11-19','2026-11-20']);
 assert.deepEqual(bars.map(x=>x.percent),[50,100]);
 assert.deepEqual(bars.map(x=>x.netCents),['10000','20000']);
});
test('não gera barras fictícias ou altura impossível com devoluções e zero vendas',()=>{
 assert.deepEqual(toSalesBars([]),[]);
 assert.deepEqual(toSalesBars([{day:'2026-11-20',sale_count:1,gross_cents:'1200',refunded_cents:'1900'}])[0].percent,0);
 assert.deepEqual(toSalesBars([{day:'2026-11-20',sale_count:0,gross_cents:'0',refunded_cents:'0'}])[0].percent,0);
});
test('usa bigint ao calcular escalas para centavos maiores que Number.MAX_SAFE_INTEGER',()=>{
 const rows=toSalesBars([
  {day:'2026-11-19',sale_count:1,gross_cents:'900719925474099300',refunded_cents:'0'},
  {day:'2026-11-20',sale_count:1,gross_cents:'450359962737049650',refunded_cents:'0'}
 ]);
 assert.deepEqual(rows.map(x=>x.percent),[100,50]);
});