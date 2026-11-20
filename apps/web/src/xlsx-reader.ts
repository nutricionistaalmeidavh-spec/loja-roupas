/**
 * Leitor XLSX local para o modelo de importação da loja.
 * Usa APIs nativas (ZIP + XML) do navegador/Electron, sem CDN ou SaaS.
 * Limites deliberados para evitar arquivos ZIP inflados ou malformados.
 */
type ZipItem={method:number;start:number;compressed:number;uncompressed:number};
const MAX_ZIP_SIZE=2*1024*1024, MAX_SHEET=8*1024*1024;
function parseZip(buffer:ArrayBuffer):Map<string,ZipItem>{
 if(buffer.byteLength>MAX_ZIP_SIZE)throw new Error('Arquivo Excel maior que 2 MB. Divida a planilha.');
 const view=new DataView(buffer),bytes=new Uint8Array(buffer),end=Math.max(0,bytes.length-65557);
 let eocd=-1;
 for(let at=bytes.length-22;at>=end;at--)if(view.getUint32(at,true)===0x06054b50){eocd=at;break;}
 if(eocd<0)throw new Error('Arquivo não é um Excel .xlsx válido.');
 const count=view.getUint16(eocd+10,true),offset=view.getUint32(eocd+16,true);
 if(count>1000||offset>=buffer.byteLength)throw new Error('Planilha Excel contém entradas demais.');
 const entries=new Map<string,ZipItem>();let at=offset;
 for(let i=0;i<count;i++){
  if(at+46>bytes.length||view.getUint32(at,true)!==0x02014b50)throw new Error('Pacote XLSX inválido.');
  const flags=view.getUint16(at+8,true),method=view.getUint16(at+10,true);
  const compressed=view.getUint32(at+20,true),uncompressed=view.getUint32(at+24,true);
  const filenameLength=view.getUint16(at+28,true),extraLength=view.getUint16(at+30,true),commentLength=view.getUint16(at+32,true);
  const localOffset=view.getUint32(at+42,true);
  if(uncompressed>MAX_SHEET||compressed>MAX_ZIP_SIZE||localOffset+30>bytes.length)
   throw new Error('Arquivo Excel muito grande ou inválido.');
  const name=new TextDecoder('utf-8').decode(bytes.slice(at+46,at+46+filenameLength));
  if(flags&1)throw new Error('Planilhas Excel protegidas por senha não são suportadas.');
  if(name.startsWith('xl/')&&!name.includes('../'))entries.set(name,{method,start:localOffset,compressed,uncompressed});
  at+=46+filenameLength+extraLength+commentLength;
 }
 return entries;
}
async function unzipText(buffer:ArrayBuffer,items:Map<string,ZipItem>,name:string):Promise<string>{
 const entry=items.get(name);
 if(!entry)throw new Error('Planilha não contém '+name);
 const view=new DataView(buffer);
 if(view.getUint32(entry.start,true)!==0x04034b50)throw new Error('XLSX com estrutura incorreta.');
 const headerLength=30+view.getUint16(entry.start+26,true)+view.getUint16(entry.start+28,true);
 const start=entry.start+headerLength;
 if(start+entry.compressed>buffer.byteLength)throw new Error('Arquivo Excel truncado.');
 const blob=new Blob([buffer.slice(start,start+entry.compressed)]);
 if(entry.method===0)return blob.text();
 if(entry.method!==8||typeof DecompressionStream==='undefined')
  throw new Error('Compressão XLSX não suportada. Salve a planilha como CSV UTF-8.');
 try{
  const stream=blob.stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const decompressed=await new Response(stream).arrayBuffer();
  if(decompressed.byteLength>MAX_SHEET)throw new Error('Planilha Excel excede o limite de tamanho.');
  return new TextDecoder('utf-8').decode(decompressed);
 }catch(error){
  if(error instanceof Error&&error.message.includes('limite'))throw error;
  throw new Error('Não foi possível descompactar o Excel. Salve a planilha como CSV UTF-8.');
 }
}
function parseXml(xml:string):Document{
 const doc=new DOMParser().parseFromString(xml,'application/xml');
 if(doc.getElementsByTagName('parsererror').length)throw new Error('XML interno do Excel inválido.');
 return doc;
}
function sheetPath(workbook:Document,rels:Document):string|null{
 const sheets=Array.from(workbook.getElementsByTagNameNS('*','sheet'));
 const choice=sheets.find(sheet=>sheet.getAttribute('name')?.toLocaleLowerCase('pt-BR')==='produtos')??sheets[0];
 if(!choice)return null;
 const id=choice.getAttribute('r:id')??choice.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
 if(!id)return null;
 const rel=Array.from(rels.getElementsByTagNameNS('*','Relationship')).find(item=>item.getAttribute('Id')===id);
 const target=rel?.getAttribute('Target')??'';
 if(!target||target.includes('..'))return null;
 return target.startsWith('/')?target.replace(/^\/+/, ''):'xl/'+target.replace(/^xl\//,'');
}
function columnIndex(reference:string):number{
 const letters=/^[A-Z]+/i.exec(reference)?.[0]??'';
 let col=0;
 for(const c of letters.toUpperCase())col=col*26+c.charCodeAt(0)-64;
 return col-1;
}
function getCellText(cell:Element,shared:string[]):string{
 const t=cell.getAttribute('t');
 if(t==='inlineStr')return Array.from(cell.getElementsByTagNameNS('*','t')).map(el=>el.textContent??'').join('');
 const v=cell.getElementsByTagNameNS('*','v')[0]?.textContent??'';
 if(t==='s')return shared[Number(v)]??'';
 if(t==='b')return v==='1'?'TRUE':'FALSE';
 return v;
}
function csvCell(value:string):string{
 return /[;"\r\n]/.test(value)?'"'+value.replace(/"/g,'""')+'"':value;
}
export async function readProductXlsx(buffer:ArrayBuffer):Promise<string>{
 const entries=parseZip(buffer);
 let worksheet='xl/worksheets/sheet1.xml';
 if(entries.has('xl/workbook.xml')&&entries.has('xl/_rels/workbook.xml.rels')){
  const wb=parseXml(await unzipText(buffer,entries,'xl/workbook.xml'));
  const rels=parseXml(await unzipText(buffer,entries,'xl/_rels/workbook.xml.rels'));
  worksheet=sheetPath(wb,rels)??worksheet;
 }
 const shared:string[]=[];
 if(entries.has('xl/sharedStrings.xml')){
  const doc=parseXml(await unzipText(buffer,entries,'xl/sharedStrings.xml'));
  for(const item of Array.from(doc.getElementsByTagNameNS('*','si')))
   shared.push(Array.from(item.getElementsByTagNameNS('*','t')).map(el=>el.textContent??'').join(''));
 }
 const doc=parseXml(await unzipText(buffer,entries,worksheet));
 const rows:string[][]=[];
 for(const row of Array.from(doc.getElementsByTagNameNS('*','row'))){
  if(rows.length>301)throw new Error('Limite de 300 linhas por importação.');
  const values=Array<string>(8).fill('');
  for(const cell of Array.from(row.getElementsByTagNameNS('*','c'))){
   const col=columnIndex(cell.getAttribute('r')??'');
   if(col>=0&&col<8)values[col]=getCellText(cell,shared);
  }
  if(values.some(v=>v.trim()))rows.push(values);
 }
 if(!rows.length)throw new Error('A aba Produtos da planilha está vazia.');
 return rows.map(row=>row.map(csvCell).join(';')).join('\r\n');
}
