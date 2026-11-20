/**
 * Gera um arquivo OOXML XLSX localmente, sem CDN, bibliotecas externas ou contas.
 * Modelo compatível com Excel e LibreOffice, usando ZIP sem compressão.
 */
const main='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relOffice='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const relPackage='http://schemas.openxmlformats.org/package/2006/relationships';
const escapeXml=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;')
 .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
function excelColumn(index:number){
 let column='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))column=String.fromCharCode(65+(n-1)%26)+column;
 return column;
}
function sheet(rows:(string|number)[][],isProduct=false){
 const lines=rows.map((cells,row)=>
  '<row r="'+(row+1)+'">'+cells.map((value,col)=>{
   const ref=excelColumn(col)+(row+1);
   return typeof value==='number'
    ?'<c r="'+ref+'"><v>'+value+'</v></c>'
    :'<c r="'+ref+'" t="inlineStr"><is><t>'+escapeXml(value)+'</t></is></c>';
  }).join('')+'</row>');
 return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
  '<worksheet xmlns="'+main+'"><sheetViews><sheetView workbookViewId="0">'+
  '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'+
  '<sheetData>'+lines.join('')+'</sheetData>'+
  (isProduct?'<autoFilter ref="A1:H'+rows.length+'"/>':'')+'</worksheet>';
}
function checksum(bytes:Uint8Array):number{
 let crc=0xffffffff;
 for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 return (crc^0xffffffff)>>>0;
}
function archive(entries:[string,string][]):Blob{
 const encoder=new TextEncoder(),parts:BlobPart[]=[],directory:Uint8Array<ArrayBuffer>[]=[];
 let offset=0,dirSize=0;
 for(const [filename,content] of entries){
  const name=encoder.encode(filename),bytes=encoder.encode(content);
  const crc=checksum(bytes);
  const local=new Uint8Array(30),head=new DataView(local.buffer);
  head.setUint32(0,0x04034b50,true);head.setUint16(4,20,true);
  head.setUint32(14,crc,true);head.setUint32(18,bytes.byteLength,true);
  head.setUint32(22,bytes.byteLength,true);head.setUint16(26,name.length,true);
  parts.push(local,name,bytes);
  const central=new Uint8Array(46),view=new DataView(central.buffer);
  view.setUint32(0,0x02014b50,true);view.setUint16(4,20,true);view.setUint16(6,20,true);
  view.setUint32(16,crc,true);view.setUint32(20,bytes.length,true);
  view.setUint32(24,bytes.length,true);view.setUint16(28,name.length,true);
  view.setUint32(42,offset,true);
  directory.push(central,name);
  offset+=local.length+name.length+bytes.length;dirSize+=central.length+name.length;
 }
 const end=new Uint8Array(22),e=new DataView(end.buffer);
 e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);
 e.setUint16(10,entries.length,true);e.setUint32(12,dirSize,true);e.setUint32(16,offset,true);
 parts.push(...directory,end);
 return new Blob(parts,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export function createProductXlsxTemplate():Blob{
 const products:(string|number)[][]=[
  ['produto','categoria','sku','cor','tamanho','preco','codigo_barras','estoque_inicial'],
  ['Camisa de linho','Feminino','LIN-BG-P','Bege','P',149.90,'',4],
  ['Camisa de linho','Feminino','LIN-BG-M','Bege','M',149.90,'',6],
  ['Vestido midi','Feminino','VES-PR-M','Preto','M',219.90,'',3]
 ];
 const instructions:(string|number)[][]=[
  ['Instruções — importação de roupas'],
  ['1. Preencha uma linha para cada combinação de peça, cor e tamanho.'],
  ['2. Repita o nome e a categoria para todas as variantes do mesmo produto.'],
  ['3. SKU deve ser único na planilha e na loja. Use letras, números, hífen e sublinhado.'],
  ['4. Preço em reais (149,90); estoque inicial é opcional e usa números inteiros.'],
  ['5. Código de barras é opcional. Formate a coluna como texto para preservar zeros à esquerda.'],
  ['6. Exclua as linhas de exemplo antes de usar seus dados.'],
  ['7. Envie o arquivo XLSX diretamente em Produtos > Importar planilha.'],
  ['8. Confira a prévia antes de confirmar. Nada é gravado se existir erro.']
 ];
 const types='<?xml version="1.0" encoding="UTF-8"?>'+
 '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
 '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
 '<Default Extension="xml" ContentType="application/xml"/>'+
 '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
 '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'+
 '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'+
 '</Types>';
 const relationships='<?xml version="1.0" encoding="UTF-8"?>'+
 '<Relationships xmlns="'+relPackage+'"><Relationship Id="rId1" Type="'+relOffice+'/officeDocument" Target="xl/workbook.xml"/></Relationships>';
 const workbook='<?xml version="1.0" encoding="UTF-8"?>'+
 '<workbook xmlns="'+main+'" xmlns:r="'+relOffice+'"><sheets>'+
 '<sheet name="Produtos" sheetId="1" r:id="rId1"/><sheet name="Instruções" sheetId="2" r:id="rId2"/>'+
 '</sheets></workbook>';
 const internal='<?xml version="1.0" encoding="UTF-8"?>'+
 '<Relationships xmlns="'+relPackage+'">'+
 '<Relationship Id="rId1" Type="'+relOffice+'/worksheet" Target="worksheets/sheet1.xml"/>'+
 '<Relationship Id="rId2" Type="'+relOffice+'/worksheet" Target="worksheets/sheet2.xml"/>'+
 '</Relationships>';
 return archive([
  ['[Content_Types].xml',types],['_rels/.rels',relationships],
  ['xl/workbook.xml',workbook],['xl/_rels/workbook.xml.rels',internal],
  ['xl/worksheets/sheet1.xml',sheet(products,true)],
  ['xl/worksheets/sheet2.xml',sheet(instructions)]
 ]);
}
