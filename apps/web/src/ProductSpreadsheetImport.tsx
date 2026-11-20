import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { ApiError, headers, jsonRequest } from './api-client.ts';
import type { Session } from './api-client.ts';
import { requestId } from './request-id.ts';
import { parseProductCsv, PRODUCT_CSV_TEMPLATE } from './product-import.ts';
import type { ImportPreview } from './product-import.ts';
import { TaskDialog } from './TaskDialog.tsx';

type Result={products_created:number;variants_created:number;stock_units:number;replayed:boolean};

function downloadCsv(){
  const blob=new Blob([PRODUCT_CSV_TEMPLATE],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');
  anchor.href=url;anchor.download='modelo_importacao_produtos_loja_roupas.csv';
  document.body.appendChild(anchor);anchor.click();anchor.remove();
  URL.revokeObjectURL(url);
}
function countStock(preview:ImportPreview){
  return preview.products.reduce((sum,p)=>sum+p.variants.reduce((qty,v)=>qty+v.initial_stock,0),0);
}

export function ProductSpreadsheetImport({session,onSaved,onClose}:{
  session:Session;onSaved:()=>void;onClose:()=>void;
}){
  const [fileName,setFileName]=useState('');
  const [preview,setPreview]=useState<ImportPreview|null>(null);
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [uncertain,setUncertain]=useState(false);
  const [pending,setPending]=useState<{key:string;body:string}|null>(null);
  const [result,setResult]=useState<Result|null>(null);
  const [error,setError]=useState('');
  async function chooseFile(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];
    if(!file)return;
    setPreview(null);setResult(null);setError('');setPending(null);setUncertain(false);
    setFileName(file.name);
    if(!file.name.toLowerCase().endsWith('.csv')){
      setError('Envie um CSV UTF-8. No Excel, use Salvar como > CSV UTF-8 (delimitado por ponto e vírgula).');
      return;
    }
    if(file.size>1024*1024){setError('O arquivo deve ter no máximo 1 MB. Divida em lotes menores.');return;}
    setLoading(true);
    try{
      const parsed=parseProductCsv(await file.text());
      setPreview(parsed);
    }catch(err){setError(err instanceof Error?err.message:'Não foi possível ler o arquivo');}
    finally{setLoading(false);}
  }
  async function submit(){
    if(!preview||preview.issues.length||!preview.rows||busy)return;
    setError('');
    const body=JSON.stringify({products:preview.products});
    const key=pending?.body===body?pending.key:requestId();
    if(pending&&pending.body!==body&&uncertain){
      setError('Há uma importação pendente. Repita a mesma operação sem alterar o arquivo.');
      return;
    }
    setPending({key,body});
    setBusy(true);
    try{
      const response=await jsonRequest<Result>('/v1/catalog/products/import',{
        method:'POST',headers:{...headers(session,key),'content-type':'application/json'},
        body
      },fetch);
      setPending(null);setUncertain(false);setResult(response);onSaved();
    }catch(err){
      setError(err instanceof Error?err.message:'Não foi possível importar o arquivo.');
      if(!(err instanceof ApiError)||err.status===0||err.status>=500)setUncertain(true);
      else{setPending(null);setUncertain(false);}
    }finally{setBusy(false);}
  }
  const locked=busy||uncertain;
  return <TaskDialog title="Importar produtos por planilha" busy={locked} onClose={onClose} wide>
    <div className="import-steps">
      <section className="import-step">
        <h3>1. Baixe e preencha o modelo</h3>
        <p>Uma linha por combinação de roupa, cor e tamanho. Repita o nome do produto para cada variante. Use código de barras opcional e estoque inicial inteiro.</p>
        <button type="button" className="light-button" onClick={downloadCsv}>Baixar modelo CSV para Excel</button>
        <p className="muted small">Funciona sem serviço externo. O Excel permite editar e salvar em CSV UTF-8.</p>
      </section>
      <section className="import-step">
        <h3>2. Selecione o arquivo preenchido</h3>
        <label>Arquivo CSV UTF-8
          <input type="file" accept=".csv,text/csv" onChange={event=>void chooseFile(event)}
            disabled={locked||Boolean(result)} />
        </label>
        {fileName&&<p className="muted small">Arquivo: {fileName}</p>}
        {loading&&<p role="status">Lendo planilha localmente…</p>}
      </section>
      {preview&&<section className="import-step">
        <h3>3. Confira antes de cadastrar</h3>
        <div className="import-stats" aria-label="Resumo da importação">
          <div><strong>{preview.products.length}</strong><span>produtos</span></div>
          <div><strong>{preview.rows}</strong><span>variantes</span></div>
          <div><strong>{countStock(preview)}</strong><span>unidades iniciais</span></div>
          <div><strong>{preview.issues.length}</strong><span>erros</span></div>
        </div>
        {preview.issues.length>0?<div role="alert" className="import-errors">
          <strong>Corrija a planilha antes de importar:</strong>
          <ul>{preview.issues.slice(0,30).map((issue,index)=>
            <li key={index}>Linha {issue.line}: {issue.message}</li>)}</ul>
          {preview.issues.length>30&&<p>Mais {preview.issues.length-30} erros encontrados.</p>}
        </div>:<>
          <p className="muted small">Nenhum dado será gravado até a confirmação. Se um SKU já existir na loja, toda a importação será cancelada.</p>
          <div className="import-table-scroll" role="region" aria-label="Prévia de produtos" tabIndex={0}>
            <table><thead><tr><th>Produto</th><th>SKU</th><th>Cor</th><th>Tamanho</th><th>Preço</th><th>Estoque</th></tr></thead>
              <tbody>{preview.products.flatMap(p=>p.variants.map(v=>({p,v}))).slice(0,20).map(({p,v})=>
                <tr key={v.sku}><td>{p.name}</td><td>{v.sku}</td><td>{v.color}</td><td>{v.size}</td>
                  <td>{new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v.price_cents/100)}</td>
                  <td>{v.initial_stock}</td></tr>)}</tbody>
            </table>
          </div>
          {preview.rows>20&&<p className="muted small">Prévia das primeiras 20 variantes.</p>}
        </>}
      </section>}
      {error&&<p role="alert" className="error">{error}{uncertain&&' A operação pode ter sido concluída. Clique novamente em confirmar sem alterar os dados.'}</p>}
      {result&&<p role="status" className="notice">
        Importação concluída: {result.products_created} produtos, {result.variants_created} variantes e {result.stock_units} unidades.
      </p>}
      <footer className="import-actions">
        <button type="button" className="light-button" onClick={onClose} disabled={locked}>
          {result?'Fechar':'Cancelar'}
        </button>
        <button type="button" className="primary-action" onClick={()=>void submit()}
          disabled={!preview||!preview.rows||Boolean(preview.issues.length)||busy||Boolean(result)}>
          {busy?'Importando…':uncertain?'Repetir confirmação segura':'Confirmar importação'}
        </button>
      </footer>
    </div>
  </TaskDialog>;
}
