'use strict';
/*
 * Log persistente do aplicativo para o suporte pós-venda.
 * Fica em userData/logs, um arquivo por dia, no máximo 14 dias e 5 MB por dia.
 * Antes de gravar, apaga endereços de banco, tokens, senhas, e-mails, CPF/CNPJ e telefones.
 */
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');

const MAX_DAY_BYTES=5*1024*1024;
const KEEP_DAYS=14;

function redact(text){
 return String(text)
  .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi,'[banco]')
  .replace(/bearer\s+[^\s"',}]+/gi,'Bearer [oculto]')
  .replace(/(authorization|token|password|senha|secret|pix_key)(["'\s:=]+)[^\s"',}]+/gi,'$1$2[oculto]')
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,'[e-mail]')
  .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g,'[documento]')
  .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,'[documento]')
  .replace(/(?:\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b/g,'[telefone]');
}
function dayFile(dir,date=new Date()){return path.join(dir,'loja-'+date.toISOString().slice(0,10)+'.log');}

function createLog(dir){
 try{fs.mkdirSync(dir,{recursive:true,mode:0o700});}catch{/* sem pasta: log desativado */}
 const prune=()=>{
  try{
   const files=fs.readdirSync(dir).filter(f=>/^loja-\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort();
   for(const old of files.slice(0,Math.max(0,files.length-KEEP_DAYS)))fs.rmSync(path.join(dir,old),{force:true});
  }catch{/* ignora */}
 };
 prune();
 function write(source,text){
  const file=dayFile(dir);
  try{
   const size=fs.existsSync(file)?fs.statSync(file).size:0;
   if(size>MAX_DAY_BYTES)return;
   const stamp=new Date().toISOString();
   const lines=redact(text).split(/\r?\n/).filter(Boolean).map(line=>stamp+' ['+source+'] '+line.slice(0,2000));
   if(lines.length)fs.appendFileSync(file,lines.join('\n')+'\n',{mode:0o600});
  }catch{/* o log nunca derruba o aplicativo */}
 }
 return {dir,write,info:(msg)=>write('app',msg),error:(msg)=>write('erro',msg instanceof Error?msg.stack||msg.message:msg),prune};
}

/** Junta as informações do computador e o fim dos logs num arquivo de texto para mandar ao suporte. */
async function exportDiagnostic({dir,destination,appVersion,extra={}}){
 const files=(await fsp.readdir(dir).catch(()=>[])).filter(f=>/^loja-\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort().slice(-7);
 const header=[
  'Diagnóstico da Loja de Roupas',
  'Gerado em: '+new Date().toLocaleString('pt-BR'),
  'Versão do aplicativo: '+appVersion,
  'Windows/sistema: '+os.type()+' '+os.release()+' ('+os.arch()+')',
  'Memória: '+Math.round(os.totalmem()/1048576)+' MB, livre '+Math.round(os.freemem()/1048576)+' MB',
  ...Object.entries(extra).map(([k,v])=>k+': '+redact(String(v))),
  'Este arquivo não contém senhas, chaves nem dados de clientes.',
  '='.repeat(60),
 ];
 const parts=[header.join('\n')];
 let budget=3*1024*1024;
 for(const file of files.reverse()){
  if(budget<=0)break;
  const text=await fsp.readFile(path.join(dir,file),'utf8').catch(()=>'');
  const tail=text.slice(-budget);
  budget-=tail.length;
  parts.splice(1,0,'\n### '+file+'\n'+redact(tail));
 }
 await fsp.writeFile(destination,parts.join('\n'),{mode:0o600});
 return {saved:true,files:files.length};
}
module.exports={createLog,exportDiagnostic,redact,dayFile};
