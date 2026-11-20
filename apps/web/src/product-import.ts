/** Leitor local de CSV: sem CDN, cookies, serviço pago ou upload antes da confirmação. */
export type ImportVariant = {
  sku:string;color:string;size:string;price_cents:number;
  barcode?:string;initial_stock:number;
};
export type ImportProduct = {name:string;category:string;variants:ImportVariant[]};
export type ImportIssue = {line:number;message:string};
export type ImportPreview = {products:ImportProduct[];rows:number;issues:ImportIssue[]};

export const PRODUCT_CSV_COLUMNS = [
  'produto','categoria','sku','cor','tamanho','preco','codigo_barras','estoque_inicial'
] as const;

export const PRODUCT_CSV_TEMPLATE =
  '\uFEFF'+PRODUCT_CSV_COLUMNS.join(';')+'\r\n'+
  'Camisa de linho;Feminino;LIN-BG-P;Bege;P;149,90;;4\r\n'+
  'Camisa de linho;Feminino;LIN-BG-M;Bege;M;149,90;;6\r\n'+
  'Vestido midi;Feminino;VES-PR-M;Preto;M;219,90;;3\r\n';

function splitCsv(source:string,separator:string):string[][]{
  const rows:string[][]=[];
  let line:string[]=[],field='',quoted=false;
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(ch==='"'){
      if(quoted&&source[i+1]==='"'){field+='"';i++;}
      else if(!quoted&&field==='')quoted=true;
      else if(quoted)quoted=false;
      else throw new Error('Aspas fora de um campo válido');
    }else if(ch===separator&&!quoted){line.push(field);field='';}
    else if((ch==='\n'||ch==='\r')&&!quoted){
      if(ch==='\r'&&source[i+1]==='\n')i++;
      line.push(field);
      if(line.some(value=>value.trim()))rows.push(line);
      line=[];field='';
    }else field+=ch;
  }
  if(quoted)throw new Error('Campo com aspas não fechado');
  line.push(field);
  if(line.some(value=>value.trim()))rows.push(line);
  return rows;
}

function cents(raw:string):number|null{
  const normalized=raw.replace(/\s/g,'').replace(/^R\$/i,'');
  if(!/^\d{1,8}(?:[,.]\d{1,2})?$/.test(normalized)&&
     !/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(normalized))return null;
  const value=normalized.includes(',')
    ?normalized.replace(/\./g,'').replace(',','.')
    :normalized;
  const [real,decimal='']=value.split('.');
  const parsed=Number(real)*100+Number((decimal+'00').slice(0,2));
  return Number.isSafeInteger(parsed)?parsed:null;
}

export function parseProductCsv(source:string):ImportPreview{
  const issues:ImportIssue[]=[];
  const fail=(line:number,message:string)=>issues.push({line,message});
  if(!source.trim())return {products:[],rows:0,issues:[{line:1,message:'Planilha vazia'}]};
  if(source.length>1024*1024)return {products:[],rows:0,issues:[{line:1,message:'Máximo de 1 MB por arquivo'}]};
  const clean=source.replace(/^\uFEFF/,'');
  const header=clean.split(/\r?\n/,1)[0]??'';
  const separator=header.split(';').length>=header.split(',').length?';':',';
  let table:string[][];
  try{table=splitCsv(clean,separator);}
  catch(err){return {products:[],rows:0,issues:[{line:1,message:err instanceof Error?err.message:'CSV inválido'}]};}
  if(!table.length)return {products:[],rows:0,issues:[{line:1,message:'Nenhuma linha encontrada'}]};
  const cols=table[0].map(x=>x.trim().toLowerCase().replace(/\s/g,'_'));
  if(cols.join('|')!==PRODUCT_CSV_COLUMNS.join('|')){
    return {products:[],rows:0,issues:[{line:1,message:'Cabeçalho inválido. Baixe o modelo oficial e não altere as colunas.'}]};
  }
  const products:ImportProduct[]=[];
  const groups=new Map<string,ImportProduct>();
  const usedSkus=new Set<string>(),usedBarcodes=new Set<string>();
  let rowCount=0;
  for(let i=1;i<table.length;i++){
    const line=i+1,values=table[i];
    if(values.length!==PRODUCT_CSV_COLUMNS.length){fail(line,'Quantidade de colunas incorreta');continue;}
    const [product,category,skuInput,color,size,priceInput,barcodeInput,stockInput]=values.map(x=>x.trim());
    if(!product||!category||!skuInput||!color||!size){fail(line,'Preencha produto, categoria, SKU, cor e tamanho');continue;}
    if(product.length>200||category.length>100||color.length>100||size.length>32){
      fail(line,'Nome, categoria, cor ou tamanho excede o limite');continue;
    }
    const sku=skuInput.toUpperCase(),barcode=barcodeInput||undefined;
    if(!/^[A-Z0-9_-]{1,64}$/.test(sku)){fail(line,'SKU inválido; use letras, números, hífen ou sublinhado');continue;}
    if(barcode&&barcode.length>128){fail(line,'Código de barras muito longo');continue;}
    const price=cents(priceInput);
    if(price===null){fail(line,'Preço inválido. Use 149,90 ou 149.90');continue;}
    if(!/^\d{1,7}$/.test(stockInput||'0')||Number(stockInput)>1000000){
      fail(line,'Estoque deve ser inteiro entre zero e 1.000.000');continue;
    }
    const key=product.toLocaleLowerCase('pt-BR')+'\u0000'+category.toLocaleLowerCase('pt-BR');
    const group=groups.get(key);
    if(usedSkus.has(sku)){fail(line,'SKU duplicado no arquivo: '+sku);continue;}
    if(barcode&&usedBarcodes.has(barcode)){fail(line,'Código de barras duplicado no arquivo');continue;}
    if(group?.variants.some(v=>v.color.toLocaleLowerCase('pt-BR')===color.toLocaleLowerCase('pt-BR')&&
        v.size.toLocaleLowerCase('pt-BR')===size.toLocaleLowerCase('pt-BR'))){
      fail(line,'Cor e tamanho duplicados para o mesmo produto');continue;
    }
    const target=group??{name:product,category,variants:[]};
    if(!group){groups.set(key,target);products.push(target);}
    target.variants.push({sku,color,size,price_cents:price,initial_stock:Number(stockInput||0),
      ...(barcode?{barcode}:{})});
    usedSkus.add(sku);if(barcode)usedBarcodes.add(barcode);
    rowCount++;
  }
  if(products.length>100)fail(1,'Limite de 100 produtos por importação');
  if(rowCount>2000)fail(1,'Limite de 2.000 variantes por importação');
  if(!rowCount&&!issues.length)fail(2,'Nenhum produto encontrado');
  if(products.some(p=>p.variants.length>200))fail(1,'Uma peça possui mais de 200 variantes');
  return {products,rows:rowCount,issues};
}
