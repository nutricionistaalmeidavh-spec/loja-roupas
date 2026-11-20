import test from 'node:test';
import assert from 'node:assert/strict';
import {collectFilteredStock} from './stock-filtered-export.ts';
import type {StockSpreadsheetPage} from './api-client.ts';

function page(rows:string[],total:number,offset:number):StockSpreadsheetPage{
 return {total,offset,limit:2,categories:[],items:rows.map(sku=>({variant_id:sku,sku} as StockSpreadsheetPage['items'][number]))};
}
test('P2 exporta todo o resultado paginado e sem duplicações',async()=>{
 const calls:number[]=[];
 const result=await collectFilteredStock(async offset=>{
  calls.push(offset);
  return offset===0?page(['a','b'],3,0):page(['c'],3,2);
 },2,100);
 assert.deepEqual(result.map(v=>v.sku),['a','b','c']);
 assert.deepEqual(calls,[0,2]);
});
test('P2 exportação falha sem truncar quando há mais que limite',async()=>{
 await assert.rejects(()=>collectFilteredStock(async()=>page([],120,0),2,100),/limite/i);
});
test('P2 exportação aborta se o total muda ou se há SKUs repetidos',async()=>{
 await assert.rejects(()=>collectFilteredStock(async offset=>
  offset===0?page(['a','b'],3,0):page(['c'],4,2),2,100),/mudou/i);
 await assert.rejects(()=>collectFilteredStock(async offset=>
  offset===0?page(['a','b'],3,0):page(['b'],3,2),2,100),/duplicad/i);
});
test('P2 exportação não permite página incompleta intermediária',async()=>{
 await assert.rejects(()=>collectFilteredStock(async()=>page(['a'],3,0),2,100),/incomplet/i);
});
