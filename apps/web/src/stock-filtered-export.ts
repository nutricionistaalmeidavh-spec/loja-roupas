import {listStockSpreadsheet} from './api-client.ts';
import type {Session,StockSpreadsheetPage,StockSpreadsheetRow} from './api-client.ts';

export const MAX_EXPORTED_SKUS=10000;
export async function collectFilteredStock(
 fetchPage:(offset:number)=>Promise<StockSpreadsheetPage>,
 limit=100,maxRows=MAX_EXPORTED_SKUS,onProgress?:(rows:number,total:number)=>void
):Promise<StockSpreadsheetRow[]>{
 const first=await fetchPage(0);
 const total=first.total;
 if(!Number.isSafeInteger(total)||total<0)throw new Error('Total de resultados inválido');
 if(total>maxRows)throw new Error('Resultado excede o limite de '+maxRows.toLocaleString('pt-BR')+
  ' SKUs. Refine os filtros ou exporte em partes.');
 const result:StockSpreadsheetRow[]=[];
 const seen=new Set<string>();
 let offset=0,page=first;
 while(offset<total){
  if(page.total!==total)throw new Error('O total de SKUs mudou durante a exportação. Repita para obter arquivo consistente.');
  const expected=Math.min(limit,total-offset);
  if(page.items.length!==expected)
   throw new Error('Página incompleta durante a exportação. Repita o procedimento.');
  for(const row of page.items){
   if(seen.has(row.variant_id))throw new Error('Linhas duplicadas entre páginas; exportação cancelada.');
   seen.add(row.variant_id);result.push(row);
  }
  offset+=page.items.length;
  onProgress?.(offset,total);
  if(offset<total)page=await fetchPage(offset);
 }
 return result;
}
export async function downloadFilteredStockXlsx(
 session:Session,filter:{query:string;category:string},onProgress?:(count:number,total:number)=>void
):Promise<number>{
 const pageSize=100;
 const rows=await collectFilteredStock(
  offset=>listStockSpreadsheet(session,{...filter,limit:pageSize,offset}),
  pageSize,MAX_EXPORTED_SKUS,onProgress);
 const excel=await import('./product-xlsx-file.ts');
 await excel.downloadStockXlsx(rows);
 return rows.length;
}
