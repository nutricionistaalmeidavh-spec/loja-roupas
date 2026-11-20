import {useEffect,useState} from 'react';
import type {ChangeEvent} from 'react';
import {headers,jsonRequest,ApiError} from './api-client.ts';
import type {Session} from './api-client.ts';
import {requestId} from './request-id.ts';
import {CSV_TEMPLATE,parseProductCsv} from './product-import.ts';
import {readProductXlsx} from './xlsx-reader.ts';
import type {ImportPreview} from './product-import.ts';

type ImportResult={products_created:number;variants_created:number;stock_units_received:number;product_ids:string[]};

function downloadTemplate(){
 const blob=new Blob([CSV_TEMPLATE],{type:'text/csv;charset=utf-8'});
 const url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download='modelo-importacao-produtos.csv';
 document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function ProductImport({session,onSaved,onLockChange}:{session:Session;onSaved:()=>void;onLockChange?:(locked:boolean)=>void}){
 const [filename,setFilename]=useState('');
 const [preview,setPreview]=useState<ImportPreview|null>(null);
 const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
 const [pending,setPending]=useState<{body:string;key:string}|null>(null);
 const [notice,setNotice]=useState(''),[error,setError]=useState('');
 useEffect(()=>{onLockChange?.(busy||uncertain);return ()=>onLockChange?.(false);},[busy,uncertain,onLockChange]);
 async function choose(event:ChangeEvent<HTMLInputElement>){
  const file=event.target.files?.[0];event.target.value='';
  if(!file||busy||uncertain)return;
  setFilename(file.name);setPreview(null);setError('');setNotice('');setPending(null);
  if(!/\.(csv|xlsx)$/i.test(file.name)){setError('Selecione uma planilha .csv ou .xlsx.');return;}
  if(file.size>2*1024*1024){setError('Arquivo maior que 2 MB. Divida em lotes de até 300 linhas.');return;}
  try{const csv=/\.xlsx$/i.test(file.name)?await readProductXlsx(await file.arrayBuffer()):await file.text();
   setPreview(parseProductCsv(csv));}
  catch(err){setError(err instanceof Error?err.message:'Não foi possível ler o arquivo');}
 }
 async function confirm(){
  if(!preview||preview.errors.length||!preview.rows.length||busy)return;
  const body=JSON.stringify({rows:preview.rows});
  if(uncertain&&pending&&pending.body!==body){setError('Reenvie exatamente a planilha pendente.');return;}
  const key=pending?.body===body?pending.key:requestId();
  setPending({body,key});setBusy(true);setError('');setNotice('');
  try{
   const result=await jsonRequest<ImportResult>('/v1/catalog/imports',{
    method:'POST',headers:{...headers(session,key),'content-type':'application/json'},body
   },fetch);
   setNotice('Importação concluída: '+result.products_created+' produtos, '+result.variants_created+
    ' variantes e '+result.stock_units_received+' unidades no estoque.');
   setPending(null);setUncertain(false);setPreview(null);setFilename('');
   onSaved();
  }catch(err){
   setError(err instanceof Error?err.message:'Importação indisponível');
   setUncertain(!(err instanceof ApiError)||err.status===0||err.status>=500);
   if(err instanceof ApiError&&err.status>0&&err.status<500)setPending(null);
  }finally{setBusy(false);}
 }
 return <div className="import-workflow">
  <p className="muted">Cadastre várias roupas, grades de tamanho, preços, códigos de barras e estoque inicial de uma vez.</p>
  <div className="import-steps">
   <section><strong>1. Baixe o modelo</strong>
    <p>Abra o modelo no Excel ou LibreOffice, substitua os exemplos e salve em CSV UTF-8 ou Excel (.xlsx).</p>
    <button type="button" className="light-button" onClick={downloadTemplate}>Baixar modelo da planilha (.csv)</button>
   </section>
   <section><strong>2. Envie a planilha preenchida</strong>
    <label className="import-file-label">Selecionar planilha (.csv ou .xlsx)
     <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy||uncertain} onChange={event=>void choose(event)}/>
    </label>
    {filename&&<p className="muted small">Arquivo: {filename}</p>}
   </section>
  </div>
  {preview&&<section aria-label="Prévia da importação" className="import-preview">
   <h3>3. Conferir antes de importar</h3>
   <div className="import-stats"><span>{preview.products.length} produtos</span><span>{preview.rows.length} variantes</span>
    <span>{preview.rows.reduce((sum,row)=>sum+row.initial_stock,0)} unidades de estoque</span></div>
   {preview.errors.length>0&&<div className="error" role="alert">
    <strong>Corrija {preview.errors.length} erros na planilha antes de importar:</strong>
    <ul>{preview.errors.slice(0,20).map((msg,i)=><li key={i}>{msg}</li>)}</ul>
    {preview.errors.length>20&&<p>Há mais erros. Corrija os primeiros e envie novamente.</p>}
   </div>}
   <div className="management-table-scroll" role="region" tabIndex={0} aria-label="Itens da importação">
    <table><thead><tr><th>Produto</th><th>SKU</th><th>Cor / tamanho</th><th>Preço</th><th>Estoque</th></tr></thead>
     <tbody>{preview.rows.slice(0,12).map(row=><tr key={row.sku}>
      <td>{row.name}</td><td>{row.sku}</td><td>{row.color} / {row.size}</td>
      <td>{(row.price_cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</td>
      <td>{row.initial_stock}</td>
     </tr>)}</tbody>
    </table>
   </div>
   {preview.rows.length>12&&<p className="muted small">Prévia dos primeiros 12 itens. A confirmação inclui todos os itens válidos.</p>}
   <p className="muted">Todos os registros são gravados em uma transação: se houver conflito de SKU ou erro, nenhum produto deste arquivo será cadastrado.</p>
   <button type="button" className="primary-action" onClick={()=>void confirm()}
    disabled={busy||preview.errors.length>0||preview.rows.length===0}>
    {busy?'Importando…':uncertain?'Repetir importação pendente':'Confirmar importação'}
   </button>
  </section>}
  {error&&<p role="alert" className="error">{error}{uncertain&&' O servidor pode ter gravado os dados. Use o botão de repetição sem alterar o arquivo.'}</p>}
  {notice&&<p role="status" className="notice">{notice}</p>}
  <p className="muted small">Limite: 300 linhas e 2 MB por arquivo. SKU e código de barras devem ser únicos. Serviços externos não são necessários.</p>
 </div>;
}
