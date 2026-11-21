import {useEffect,useState} from 'react';
import type {Session,InventoryHistoryOptions,InventoryMovement,InventoryMovementFilters} from './api-client.ts';
import {listSpreadsheetHistory,listInventoryHistoryOptions,headers,jsonRequest} from './api-client.ts';
import {requestId} from './request-id.ts';
import {TaskDialog} from './TaskDialog.tsx';

const labels:Record<string,string>={
 receipt:'Recebimento',sale:'Venda',return:'Devolução',adjustment:'Ajuste'
};
const origins:Record<string,string>={
 manual_receipt:'Entrada manual',direct_receipt:'Entrada direta',direct_receipt_reversal:'Estorno de entrada direta',spreadsheet_import:'Importação XLSX/CSV',
 purchase:'Pedido de compra',sale:'PDV',sale_return:'Pós-venda',
 manager_adjustment:'Ajuste gerencial'
};
type Filters={
 from:string;to:string;movement_kind:string;source_type:string;supplier_id:string;purchase_id:string;operator_id:string;
};
const empty:Filters={from:'',to:'',movement_kind:'',source_type:'',supplier_id:'',purchase_id:'',operator_id:''};

export function StockMovementHistory({session,variantId,sku,onClose}:{
 session:Session;variantId?:string;sku?:string;onClose:()=>void;
}){
 const [filters,setFilters]=useState<Filters>(empty);
 const [options,setOptions]=useState<InventoryHistoryOptions>({suppliers:[],operators:[],purchases:[]});
 const [list,setList]=useState<InventoryMovement[]>([]);
 const [total,setTotal]=useState(0);
 const [offset,setOffset]=useState(0);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [optionsError,setOptionsError]=useState('');
 const [refresh,setRefresh]=useState(0);
 const [reversing,setReversing]=useState<InventoryMovement|null>(null);
 const [reason,setReason]=useState('');
 const [reversalKey,setReversalKey]=useState('');
 const [reverseBusy,setReverseBusy]=useState(false);
 async function reverse(){
  if(!reversing||reason.trim().length<8)return;
  setReverseBusy(true);setError('');
  try{
   await jsonRequest('/v1/stock/direct-receipt/'+reversing.id+'/reverse',{
    method:'POST',headers:{...headers(session,reversalKey),'content-type':'application/json'},body:JSON.stringify({reason:reason.trim()})},fetch);
   setReversing(null);setReason('');setRefresh(x=>x+1);
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível estornar a entrada');}
  finally{setReverseBusy(false);}
 }
 const limit=50;
 function setField<K extends keyof Filters>(key:K,value:Filters[K]){
  setFilters(current=>({...current,[key]:value}));setOffset(0);
 }
 useEffect(()=>{
  let active=true;
  void listInventoryHistoryOptions(session).then(v=>{if(active)setOptions(v);})
   .catch(e=>{if(active)setOptionsError(e instanceof Error?e.message:'Não foi possível consultar filtros');});
  return ()=>{active=false;};
 },[session]);
 useEffect(()=>{
  const ctrl=new AbortController();
  setLoading(true);setError('');
  const query:InventoryMovementFilters={limit,offset,...(variantId?{variant_id:variantId}:{})};
  for(const [key,val] of Object.entries(filters))if(val)(query as Record<string,string|number>)[key]=val;
  void listSpreadsheetHistory(session,query,fetch,ctrl.signal).then(v=>{
   if(ctrl.signal.aborted)return;
   setList(v.items);setTotal(v.total);
  }).catch(e=>{
   if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Não foi possível consultar o histórico');
  }).finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
  return ()=>ctrl.abort();
 },[session,variantId,filters,offset,refresh]);
 const purchases=options.purchases.filter(p=>!filters.supplier_id||
  options.suppliers.some(s=>s.id===filters.supplier_id&&s.name===p.supplier_name));
 return <TaskDialog wide title={sku?'Histórico — '+sku:'Histórico completo de estoque'} onClose={onClose}>
  <div className="sheet-history-full">
   <p className="muted">Histórico auditável das entradas, vendas, devoluções e ajustes da loja.
    Datas seguem o fuso horário configurado para a loja. Resultados são paginados, sem cortar o histórico.</p>
   <div className="sheet-history-filters">
    <label>De
     <input type="date" value={filters.from} max={filters.to||undefined}
      onChange={e=>setField('from',e.target.value)}/>
    </label>
    <label>Até
     <input type="date" value={filters.to} min={filters.from||undefined}
      onChange={e=>setField('to',e.target.value)}/>
    </label>
    <label>Tipo
     <select value={filters.movement_kind} onChange={e=>setField('movement_kind',e.target.value)}>
      <option value="">Todos os movimentos</option>
      {Object.entries(labels).map(([key,value])=><option value={key} key={key}>{value}</option>)}
     </select>
    </label>
    <label>Origem
     <select value={filters.source_type} onChange={e=>setField('source_type',e.target.value)}>
      <option value="">Todas as origens</option>
      <option value="direct_receipt">Entrada direta</option><option value="direct_receipt_reversal">Estorno de entrada direta</option>
      <option value="purchase">Pedido de compra</option><option value="spreadsheet_import">Importação</option>
     </select>
    </label>
    <label>Fornecedor (pedidos)
     <select value={filters.supplier_id} onChange={e=>{setFilters(f=>({...f,supplier_id:e.target.value,purchase_id:''}));setOffset(0);}}>
      <option value="">Todos os fornecedores</option>
      {options.suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
     </select>
    </label>
    <label>Pedido de compra
     <select value={filters.purchase_id} onChange={e=>setField('purchase_id',e.target.value)}>
      <option value="">Todos os pedidos</option>
      {purchases.map(p=><option key={p.id} value={p.id}>{p.sku} · {p.supplier_name} · {p.id.slice(0,8)}</option>)}
     </select>
    </label>
    <label>Operador
     <select value={filters.operator_id} onChange={e=>setField('operator_id',e.target.value)}>
      <option value="">Todos os operadores</option>
      {options.operators.map(u=><option key={u.id} value={u.id}>{u.login}</option>)}
     </select>
    </label>
   </div>
   <div className="workspace-actions">
    <button type="button" className="light-button" onClick={()=>{setFilters(empty);setOffset(0);}}>
     Limpar filtros
    </button>
    <button type="button" className="light-button" disabled={loading} onClick={()=>setRefresh(n=>n+1)}>
     Atualizar histórico
    </button>
   </div>
   {optionsError&&<p role="alert" className="error">{optionsError}</p>}
   {error&&<p role="alert" className="error">{error}</p>}
   {loading&&<p role="status">Carregando movimentações…</p>}
   {!loading&&!error&&<p className="muted small">{total} movimentações encontradas — {offset+1} a {Math.min(offset+list.length,total)}</p>}
   <div className="sheet-history-table" role="region" aria-label="Histórico de movimentações" tabIndex={0}>
    <table>
     <thead><tr><th>Data</th><th>SKU</th><th>Movimento</th><th>Qtd.</th><th>Origem</th><th>Fornecedor / Pedido</th><th>Operador</th>{session.roles.includes('manager')&&<th>Ação</th>}</tr></thead>
     <tbody>{list.map(m=><tr key={m.id}>
      <td>{new Date(m.occurred_at).toLocaleString('pt-BR')}</td>
      <td>{m.sku}</td>
      <td>{labels[m.movement_kind]??m.movement_kind}</td>
      <td className={m.qty_delta<0?'negative':'positive'}>{m.qty_delta>0?'+':''}{m.qty_delta} peças</td>
      <td>{origins[m.source_type]??m.source_type}</td>
      <td>{m.supplier_name??'—'}{m.purchase_id?' · '+m.purchase_id.slice(0,8):''}</td>
      <td>{m.operator_login??'Não registrado'}</td>
      {session.roles.includes('manager')&&<td>{m.source_type==='direct_receipt'&&<button type="button" className="light-button" onClick={()=>{setReversing(m);setReason('');setReversalKey(requestId());}}>Estornar</button>}</td>}
     </tr>)}</tbody>
    </table>
   </div>
   {!loading&&!error&&list.length===0&&<p className="muted">Nenhum movimento encontrado para os filtros.</p>}
   {reversing&&<section className="management-form" aria-label="Estorno de entrada direta">
    <h3>Estornar entrada direta — {reversing.sku}</h3>
    <p>Esta operação subtrai {reversing.qty_delta} peças. O histórico original será preservado. O sistema bloqueará o estorno se o saldo disponível for insuficiente.</p>
    <label>Justificativa obrigatória<input value={reason} minLength={8} maxLength={250} disabled={reverseBusy} onChange={e=>setReason(e.target.value)}/></label>
    <div className="workspace-actions"><button type="button" className="light-button" disabled={reverseBusy} onClick={()=>setReversing(null)}>Cancelar</button>
    <button type="button" className="primary-action" disabled={reverseBusy||reason.trim().length<8} onClick={()=>void reverse()}>{reverseBusy?'Estornando…':'Confirmar estorno'}</button></div>
   </section>}
   <footer className="sheet-footer">
    <span>{total} registros · 50 por página</span>
    <div className="workspace-actions">
     <button type="button" className="light-button" disabled={loading||offset===0}
      onClick={()=>setOffset(n=>Math.max(0,n-limit))}>Anterior</button>
     <button type="button" className="light-button" disabled={loading||offset+list.length>=total}
      onClick={()=>setOffset(n=>n+limit)}>Próxima</button>
    </div>
   </footer>
  </div>
 </TaskDialog>;
}
