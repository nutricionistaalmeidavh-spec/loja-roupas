export type ImportRow = {
 name:string; category:string; sku:string; color:string; size:string;
 price_cents:number; barcode:string|null; initial_stock:number;
};
export type ImportProduct = {name:string;category:string;variants:ImportRow[]};
export type ImportPreview = {rows:ImportRow[];products:ImportProduct[];errors:string[]};
export const CSV_HEADERS = ['produto','categoria','sku','cor','tamanho','preco','codigo_barras','estoque_inicial'] as const;
export const CSV_TEMPLATE = '\uFEFF'+[
 CSV_HEADERS.join(';'),
 'Camisa de linho;Feminino;LIN-BG-P;Bege;P;149,90;;4',
 'Camisa de linho;Feminino;LIN-BG-M;Bege;M;149,90;;6',
 'Vestido midi;Feminino;VES-PR-M;Preto;M;219,90;;3'
].join('\r\n')+'\r\n';

function readCells(text:string,delimiter:string):string[][] {
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){
   if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}
   else if(ch==='"')quoted=false;
   else cell+=ch;
  }else if(ch==='"'&&cell==='')quoted=true;
  else if(ch===delimiter){row.push(cell.trim());cell='';}
  else if(ch==='\n'||ch==='\r'){
   if(ch==='\r'&&text[i+1]==='\n')i++;
   row.push(cell.trim());if(row.some(Boolean))rows.push(row);
   row=[];cell='';
  }else cell+=ch;
 }
 if(quoted)throw new Error('Planilha possui aspas não fechadas.');
 row.push(cell.trim());if(row.some(Boolean))rows.push(row);
 return rows;
}
function priceToCents(raw:string):number {
 const cleaned=raw.trim().replace(/^R\$\s*/i,'').replace(/\s/g,'');
 if(!cleaned||!/^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(cleaned)&&
    !/^\d+\.\d{1,2}$/.test(cleaned))throw new Error('Preço inválido');
 const decimal=cleaned.includes(',')?cleaned.replace(/\./g,'').replace(',','.'):cleaned;
 const value=Number(decimal);
 const cents=Math.round(value*100);
 if(!Number.isSafeInteger(cents)||cents<0||cents>2_000_000_000)throw new Error('Preço fora do limite');
 return cents;
}
export function parseProductCsv(text:string):ImportPreview {
 const errors:string[]=[],products=new Map<string,ImportProduct>(),rows:ImportRow[]=[];
 const source=text.replace(/^\uFEFF/,'');
 const firstLine=source.split(/\r?\n/,1)[0]??'';
 const delimiter=firstLine.split(';').length>=firstLine.split(',').length?';':',';
 let matrix:string[][];
 try{matrix=readCells(source,delimiter);}
 catch(e){return {rows:[],products:[],errors:[e instanceof Error?e.message:'CSV inválido']};}
 if(matrix.length===0)return {rows:[],products:[],errors:['Planilha vazia.']};
 const headings=matrix[0].map(c=>c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'_'));
 const required=['produto','categoria','sku','cor','tamanho','preco'];
 for(const head of required)if(!headings.includes(head))errors.push('Coluna obrigatória ausente: '+head);
 if(errors.length)return {rows:[],products:[],errors};
 if(matrix.length-1>300)return {rows:[],products:[],errors:['Limite de 300 linhas por importação. Divida a planilha.']};
 const usedSku=new Set<string>(),usedBarcode=new Set<string>();
 for(let index=1;index<matrix.length;index++){
  const cells=matrix[index];const get=(key:string)=>cells[headings.indexOf(key)]?.trim()??'';
  const n=index+1;
  try{
   const name=get('produto'),category=get('categoria'),sku=get('sku').toUpperCase(),color=get('cor'),size=get('tamanho');
   const barcode=get('codigo_barras')||null,amount=get('estoque_inicial');
   if(!name||name.length>200||!category||category.length>100)throw new Error('Produto ou categoria inválidos');
   if(!/^[A-Z0-9_-]{1,64}$/.test(sku))throw new Error('SKU inválido (use letras, números, _ ou -)');
   if(!color||color.length>100||!size||size.length>32)throw new Error('Cor ou tamanho inválidos');
   if(barcode&&barcode.length>128)throw new Error('Código de barras muito longo');
   if(usedSku.has(sku))throw new Error('SKU repetido: '+sku);
   if(barcode&&usedBarcode.has(barcode))throw new Error('Código de barras repetido: '+barcode);
   const initial_stock=amount===''?0:Number(amount);
   if(!Number.isSafeInteger(initial_stock)||initial_stock<0||initial_stock>100000)throw new Error('Estoque inicial deve ser inteiro entre 0 e 100000');
   const price_cents=priceToCents(get('preco'));
   const groupKey=name.toLocaleLowerCase('pt-BR')+'\0'+category.toLocaleLowerCase('pt-BR');
   let group=products.get(groupKey);
   if(!group){group={name,category,variants:[]};products.set(groupKey,group);}
   if(group.variants.some(v=>v.color.toLocaleLowerCase('pt-BR')===color.toLocaleLowerCase('pt-BR')&&v.size.toLocaleLowerCase('pt-BR')===size.toLocaleLowerCase('pt-BR')))
    throw new Error('Cor e tamanho repetidos para o produto');
   const row={name,category,sku,color,size,barcode,initial_stock,price_cents};
   group.variants.push(row);rows.push(row);
   usedSku.add(sku);if(barcode)usedBarcode.add(barcode);
  }catch(error){errors.push('Linha '+n+': '+(error instanceof Error?error.message:'Dados inválidos'));}
 }
 if(!rows.length&&!errors.length)errors.push('Nenhum produto encontrado.');
 return {rows,products:[...products.values()],errors};
}
