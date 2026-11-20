import { readSheet } from 'read-excel-file/browser';
import writeExcelFile from 'write-excel-file/browser';
import { PRODUCT_CSV_COLUMNS } from './product-import.ts';
import { parseProductSheetRows } from './product-xlsx.ts';
import type { ImportPreview } from './product-import.ts';

export const MAX_XLSX_FILE_SIZE=5*1024*1024;
const header=[...PRODUCT_CSV_COLUMNS];

function xlsxColumns(){
  return [26,17,20,15,12,15,26,20].map(width=>({width}));
}
function asHeader(){
  return header.map(value=>({value,fontWeight:'bold' as const,textColor:'#FFFFFF',backgroundColor:'#252525'}));
}
export async function readProductXlsx(file:File):Promise<ImportPreview>{
  if(file.size>MAX_XLSX_FILE_SIZE)throw new Error('Arquivo XLSX maior que 5 MB; divida em lotes menores.');
  const bytes=new Uint8Array(await file.slice(0,4).arrayBuffer());
  if(bytes[0]!==0x50||bytes[1]!==0x4b)throw new Error('Arquivo não é uma planilha XLSX válida.');
  const rows=await readSheet(file);
  return parseProductSheetRows(rows);
}
export async function downloadProductXlsxTemplate(){
  const rows=[
    asHeader(),
    ['Camisa de linho','Feminino','LIN-BG-P','Bege','P',{value:149.9,format:'#,##0.00'},'0001234567890',4],
    ['Camisa de linho','Feminino','LIN-BG-M','Bege','M',{value:149.9,format:'#,##0.00'},null,6],
    ['Vestido midi','Feminino','VES-PR-M','Preto','M',{value:219.9,format:'#,##0.00'},null,3]
  ];
  await writeExcelFile(rows,{sheet:'Produtos',columns:xlsxColumns(),stickyRowsCount:1}).toFile('modelo_importacao_produtos_loja_roupas.xlsx');
}
export type InventoryXlsxRow={
  name:string;category:string;sku:string;color:string;size:string;barcode:string|null;
  price_cents:number;on_hand:number;reserved:number;available:number;
  entries:number;sold:number;returns:number;adjustments:number;
};
export async function downloadStockXlsx(rows:readonly InventoryXlsxRow[]){
  const headings=['Produto','Categoria','SKU','Cor','Tamanho','Código de barras','Preço (R$)',
    'Estoque físico','Reservado','Disponível','Entradas','Vendido','Devolvido','Ajustes'];
  const sheet=[
    headings.map(value=>({value,fontWeight:'bold' as const,backgroundColor:'#252525',textColor:'#FFFFFF'})),
    ...rows.map(row=>[
      row.name,row.category,row.sku,row.color,row.size,row.barcode??'',
      {value:row.price_cents/100,format:'#,##0.00'},
      row.on_hand,row.reserved,row.available,row.entries,row.sold,row.returns,row.adjustments
    ])
  ];
  await writeExcelFile(sheet,{sheet:'Estoque',columns:headings.map((_,i)=>({width:i<2?25:i===5?23:15})),stickyRowsCount:1})
    .toFile('estoque_loja_roupas.xlsx');
}
