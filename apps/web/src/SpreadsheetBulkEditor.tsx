import {useMemo,useRef,useState} from 'react';
import {ApiError,patchSpreadsheetBulk} from './api-client.ts';
import type {Session,StockSpreadsheetRow} from './api-client.ts';
import {buildBulkClipboard,parseBulkClipboard} from './sheet-bulk-clipboard.ts';
import {requestId} from './request-id.ts';
import {TaskDialog} from './TaskDialog.tsx';

export function SpreadsheetBulkEditor({session,rows,onClose,onSaved}:{
 session:Session;rows:readonly StockSpreadsheetRow[];
 onClose:()=>void;onSaved:()=>void;
}){
 const baseline=useMemo(()=>buildBulkClipboard(rows),[rows]);
 const [content,setContent]=useState(baseline);
 const [saving,setSaving]=useState(false);
 const [message,setMessage]=useState('');
 const [error,setError]=useState('');
 const [complete,setComplete]=useState(false);
 const [uncertain,setUncertain]=useState(false);
 const [pending,setPending]=useState<{body:string;key:string}|null>(null);
 const editor=useRef<HTMLTextAreaElement>(null);
 const preview=useMemo(()=>parseBulkClipboard(content,rows),[content,rows]);
 const changed=content!==baseline;
 function restore(){
  if(saving||uncertain||complete)return;
  setContent(baseline);setError('');setMessage('Todas as alterações não salvas foram desfeitas.');
  setPending(null);
 }
 async function save(){
  if(saving||complete||preview.issues.length||!preview.updates.length)return;
  setError('');setMessage('');
  const body=JSON.stringify({items:preview.updates});
  if(uncertain&&pending?.body!==body){
   setError('Existe um envio de resultado incerto. Repita sem alterar o conteúdo.');
   return;
  }
  const key=pending?.body===body?pending.key:requestId();
  setPending({body,key});setSaving(true);
  try{
   const result=await patchSpreadsheetBulk(session,preview.updates,key);
   setComplete(true);setPending(null);setUncertain(false);
   setMessage(result.updated+' variantes conferidas; '+result.variants_updated+
    ' cadastros de SKU atualizados e '+result.products_updated+' produtos alterados. Tudo foi salvo na mesma transação.');
   onSaved();
  }catch(err){
   setError(err instanceof Error?err.message:'Não foi possível salvar o lote.');
   if(!(err instanceof ApiError)||err.status===0||err.status>=500)setUncertain(true);
   else{setUncertain(false);setPending(null);}
  }finally{setSaving(false);}
 }
 const locked=saving||uncertain;
 return <TaskDialog title="Edição em lote — copiar e colar do Excel" wide onClose={onClose} busy={locked}>
  <div className="bulk-sheet">
   <p>Copie a tabela abaixo para Excel ou LibreOffice, modifique os valores e cole de volta neste campo.
    O <strong>SKU atual</strong> identifica a peça; o <strong>SKU novo</strong> pode ser alterado.</p>
   <div className="workspace-actions">
    <button type="button" className="light-button" disabled={locked||complete} onClick={()=>{
     editor.current?.focus();editor.current?.select();
     setMessage('Tabela selecionada. Use Ctrl+C (ou Cmd+C) para copiar e Ctrl+V para colar os dados editados.');
    }}>Selecionar tabela para copiar</button>
    <button type="button" className="light-button" disabled={!changed||locked||complete} onClick={restore}>
     Desfazer alterações não salvas
    </button>
   </div>
   <label className="bulk-editor-label">Tabela TSV (copiar e colar do Excel)
    <textarea ref={editor} rows={12} spellCheck={false} value={content}
     onChange={e=>{setContent(e.target.value);setMessage('');setError('');}}
     readOnly={locked||complete}
     aria-describedby="bulk-editor-help"/>
   </label>
   <p id="bulk-editor-help" className="muted small">
    Use um lote por página (até 50 SKUs, no máximo 100 por requisição). Não altere o cabeçalho nem exclua a coluna SKU atual.
    Código de barras deve permanecer como texto para preservar zeros à esquerda. Saldo e movimentações não são editáveis.
   </p>
   <div className="import-stats">
    <div><strong>{preview.rowsRead}</strong><span>linhas lidas</span></div>
    <div><strong>{preview.updates.length}</strong><span>alterações</span></div>
    <div><strong>{preview.issues.length}</strong><span>erros</span></div>
    <div><strong>{rows.length}</strong><span>SKUs nesta página</span></div>
   </div>
   {preview.issues.length>0&&<div className="import-errors" role="alert">
    <strong>Corrija antes de salvar:</strong>
    <ul>{preview.issues.slice(0,20).map((v,i)=><li key={i}>Linha {v.line}: {v.message}</li>)}</ul>
   </div>}
   {preview.issues.length===0&&preview.updates.length>0&&<div className="bulk-preview" role="region"
    aria-label="Prévia das alterações" tabIndex={0}>
    <table><thead><tr><th>SKU novo</th><th>Produto</th><th>Cor / Tam.</th><th>Preço</th></tr></thead>
     <tbody>{preview.updates.slice(0,12).map(v=><tr key={v.variant_id}>
      <td>{v.sku}</td><td>{v.name}</td><td>{v.color} / {v.size}</td>
      <td>{new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v.price_cents/100)}</td>
     </tr>)}</tbody>
    </table>
    {preview.updates.length>12&&<p className="muted small">Prévia de 12 das {preview.updates.length} alterações.</p>}
   </div>}
   {uncertain&&<p role="alert" className="error">Não deu para confirmar se a edição foi salva.
    Não altere o texto; clique em repetir com a mesma chave para evitar duplicação.</p>}
   {error&&<p role="alert" className="error">{error}</p>}
   {message&&<p role="status" className="notice">{message}</p>}
   <footer className="import-actions">
    <button className="light-button" type="button" onClick={onClose} disabled={locked}>
     {complete?'Fechar':'Cancelar'}
    </button>
    <button className="primary-action" type="button" onClick={()=>void save()}
     disabled={saving||complete||preview.issues.length>0||preview.updates.length===0}>
     {saving?'Salvando…':uncertain?'Repetir salvamento seguro':
      'Salvar '+preview.updates.length+' alterações juntas'}
    </button>
   </footer>
  </div>
 </TaskDialog>;
}
