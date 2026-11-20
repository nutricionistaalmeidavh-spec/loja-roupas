import type {SpreadsheetRowPatch} from './api-client.ts';

export type ClipboardRow={
 variant_id:string;product_id:string;sku:string;name:string;category:string;color:string;size:string;
 barcode:string|null;price_cents:number;product_revision:number;variant_revision:number;
};
export type BulkUpdate={variant_id:string}&SpreadsheetRowPatch;
export type BulkIssue={line:number;message:string};
export const BULK_HEADERS=['SKU atual','SKU novo','Produto','Categoria','Cor','Tamanho','Código de barras','Preço (R$)'] as const;
function escapeTsv(v:string){return /[\t\n\r"]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;}
function parseTsv(input:string):string[][]{
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 const source=input.replace(/^\uFEFF/,'');
 for(let i=0;i<source.length;i++){
  const c=source[i];
  if(c==='"'){
   if(quoted&&source[i+1]==='"'){cell+='"';i++;}
   else if(quoted){quoted=false;}
   else if(!cell){quoted=true;}
   else throw new Error('Aspas inválidas');
  }else if(c==='\t'&&!quoted){row.push(cell);cell='';}
  else if((c==='\r'||c==='\n')&&!quoted){
   if(c==='\r'&&source[i+1]==='\n')i++;
   row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
   row=[];cell='';
  }else cell+=c;
 }
 if(quoted)throw new Error('Aspas sem fechamento');
 row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
 return rows;
}
function priceCents(text:string):number|null{
 const s=text.trim().replace(/^R\$\s*/,'').replace(/\s/g,'');
 if(!/^\d{1,8}(?:[,.]\d{1,2})?$/.test(s)&&!/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(s))return null;
 const normalized=s.includes(',')?s.replace(/\./g,'').replace(',','.'):s;
 const [whole,part='']=normalized.split('.');
 const cents=Number(whole)*100+Number((part+'00').slice(0,2));
 return Number.isSafeInteger(cents)&&cents<=9999999999?cents:null;
}
export function buildBulkClipboard(rows:readonly ClipboardRow[]):string{
 const lines=[BULK_HEADERS.join('\t')];
 for(const r of rows){
  const price=(r.price_cents/100).toFixed(2).replace('.',',');
  lines.push([r.sku,r.sku,r.name,r.category,r.color,r.size,r.barcode??'',price].map(escapeTsv).join('\t'));
 }
 return lines.join('\r\n');
}
export function parseBulkClipboard(source:string,existing:readonly ClipboardRow[]):{
 updates:BulkUpdate[];issues:BulkIssue[];rowsRead:number;
}{
 const issues:BulkIssue[]=[];
 if(source.length>250000)return {updates:[],issues:[{line:1,message:'O conteúdo excede 250 KB'}],rowsRead:0};
 let rows:string[][];
 try{rows=parseTsv(source);}catch(err){return {updates:[],issues:[{line:1,message:String(err)}],rowsRead:0};}
 if(!rows.length)return {updates:[],issues:[{line:1,message:'Cole o conteúdo da planilha'}],rowsRead:0};
 if(rows[0].join('|')!==BULK_HEADERS.join('|'))
  return {updates:[],issues:[{line:1,message:'Cabeçalho inválido. Use o modelo Copiar página para Excel.'}],rowsRead:0};
 if(rows.length>101)return {updates:[],issues:[{line:1,message:'Máximo 100 linhas por lote'}],rowsRead:rows.length-1};
 const original=new Map(existing.map(row=>[row.sku.toUpperCase(),row]));
 const updates:BulkUpdate[]=[];const touched=new Set<string>();
 const targets=new Map<string,string>();
 const byProduct=new Map<string,{name:string;category:string}>();
 for(let i=1;i<rows.length;i++){
  const line=i+1,values=rows[i];
  if(values.length!==8){issues.push({line,message:'Esperadas exatamente oito colunas'});continue;}
  const [oldSku,rawSku,name,category,color,size,rawBarcode,priceText]=values.map(v=>v.trim());
  const sourceRow=original.get(oldSku.toUpperCase());
  if(!sourceRow){issues.push({line,message:'SKU atual desconhecido nesta página: '+oldSku});continue;}
  if(touched.has(sourceRow.variant_id)){issues.push({line,message:'SKU atual duplicado no lote'});continue;}
  touched.add(sourceRow.variant_id);
  const sku=rawSku.toUpperCase(),barcode=rawBarcode||null;
  if(!/^[A-Z0-9_-]{1,64}$/.test(sku)||!name||!category||!color||!size||
   name.length>200||category.length>100||color.length>100||size.length>32||Boolean(barcode&&barcode.length>128)){
   issues.push({line,message:'Campos inválidos: confira SKU, nome, categoria, cor, tamanho e código de barras'});continue;
  }
  if([name,category,color,size,barcode??''].some(v=>/^[=+@]/.test(v))){
   issues.push({line,message:'Fórmulas não são permitidas em campos de texto'});continue;
  }
  const price=priceCents(priceText);
  if(price===null){issues.push({line,message:'Preço inválido; use 149,90'});continue;}
  const other=targets.get(sku);
  if(other&&other!==sourceRow.variant_id){issues.push({line,message:'SKU novo duplicado no lote: '+sku});continue;}
  targets.set(sku,sourceRow.variant_id);
  const previous=byProduct.get(sourceRow.product_id);
  if(previous&&(previous.name!==name||previous.category!==category)){
   issues.push({line,message:'Variantes do mesmo produto precisam ter mesmo nome e categoria'});continue;
  }
  byProduct.set(sourceRow.product_id,{name,category});
  if(sourceRow.sku!==sku||sourceRow.name!==name||sourceRow.category!==category||
   sourceRow.color!==color||sourceRow.size!==size||(sourceRow.barcode||null)!==barcode||
   sourceRow.price_cents!==price){
   updates.push({variant_id:sourceRow.variant_id,sku,name,category,color,size,barcode,
    price_cents:price,expected_product_revision:sourceRow.product_revision,
    expected_variant_revision:sourceRow.variant_revision});
  }
 }
 const editedById=new Map(updates.map(row=>[row.variant_id,row.sku]));
 for(const row of existing){
  const target=editedById.get(row.variant_id)??row.sku;
  const assigned=targets.get(target.toUpperCase());
  if(assigned&&assigned!==row.variant_id)
   issues.push({line:1,message:'SKU novo já pertence a outra peça da página: '+target});
 }
 return {updates:issues.length?[]:updates,issues,rowsRead:rows.length-1};
}
