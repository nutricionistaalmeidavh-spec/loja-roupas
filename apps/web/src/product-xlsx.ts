import { parseProductCsv, PRODUCT_CSV_COLUMNS } from './product-import.ts';
import type { ImportPreview, ImportIssue } from './product-import.ts';

export const MAX_XLSX_FILE_SIZE=5*1024*1024;
export type SheetCell=unknown; // read-excel-file representa tipos de célula adicionais; validar todos em runtime.

function csvCell(value:string){
  return /[;"\r\n]/.test(value)?'"'+value.replace(/"/g,'""')+'"':value;
}

/** Reusa o contrato único do importador CSV para qualquer planilha XLSX. */
export function parseProductSheetRows(table:readonly (readonly SheetCell[])[]):ImportPreview{
  if(!table.length)return {products:[],rows:0,issues:[{line:1,message:'Planilha vazia'}]};
  if(table.length>2003)return {products:[],rows:0,issues:[{line:1,message:'Limite de 2.000 variantes por arquivo'}]};
  const header=table[0].map(x=>typeof x==='string'?x.trim():String(x??''));
  const expected=[...PRODUCT_CSV_COLUMNS];
  if(header.length!==expected.length || header.some((x,i)=>x.toLowerCase().replace(/\s/g,'_')!==expected[i])){
    return {products:[],rows:0,issues:[{line:1,message:'Cabeçalho inválido. Use o modelo oficial XLSX.'}]};
  }
  const issues:ImportIssue[]=[];
  const csvRows:string[]=[expected.join(';')];
  for(let i=1;i<table.length;i++){
    const cells=table[i];
    if(cells.every(x=>x==null||x===''))continue;
    if(cells.length>expected.length){
      issues.push({line:i+1,message:'Quantidade de colunas incorreta'});
      continue;
    }
    const out:string[]=[];
    let invalid=false;
    for(let j=0;j<expected.length;j++){
      const v=cells[j];
      if(v==null||v===''){out.push('');continue;}
      if(j===6 && typeof v==='number'){
        issues.push({line:i+1,message:'Código de barras numérico: configure a coluna como texto para preservar zeros à esquerda.'});
        invalid=true;break;
      }
      if(v instanceof Date||typeof v==='boolean'||(typeof v!=='string'&&typeof v!=='number')){
        issues.push({line:i+1,message:'Tipo de célula inválido para '+expected[j]});
        invalid=true;break;
      }
      if(typeof v==='number'&&(!Number.isFinite(v)||!Number.isSafeInteger(Math.round(v*100)))){
        issues.push({line:i+1,message:'Número fora do intervalo permitido'});
        invalid=true;break;
      }
      if(j===5&&typeof v==='number'){
        const cents=v*100;
        if(v<0||Math.abs(cents-Math.round(cents))>0.000001){
          issues.push({line:i+1,message:'Preço deve ter no máximo duas casas decimais'});
          invalid=true;break;
        }
        out.push((Math.round(cents)/100).toFixed(2).replace('.',','));
      }else if(j===7&&typeof v==='number'){
        if(!Number.isSafeInteger(v)||v<0){
          issues.push({line:i+1,message:'Estoque inicial deve ser um número inteiro não negativo'});
          invalid=true;break;
        }
        out.push(String(v));
      }else out.push(String(v));
    }
    if(!invalid)csvRows.push(out.map(csvCell).join(';'));
  }
  const parsed=parseProductCsv(csvRows.join('\r\n')+'\r\n');
  return {...parsed,issues:[...parsed.issues,...issues]};
}
