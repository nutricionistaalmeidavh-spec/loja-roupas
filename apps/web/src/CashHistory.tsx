import {useEffect,useState} from 'react';
import {headers,jsonRequest} from './api-client.ts';
import type {Session} from './api-client.ts';
import {brl,errorText,METHOD_LABELS} from './idempotent-post.ts';

type CashRow={id:string;terminal_code:string;opened_at:string;closed_at:string|null;opening_cents:string;
 expected_cash_cents:string|null;counted_cash_cents:string|null;difference_cents:string|null;
 opened_by:string;closed_by:string|null;sale_count:number;sales_cents:string;close_reason:string|null};
type Summary={id:string;opening_cents:number;expected_cash_cents:number;counted_cash_cents:number|null;difference_cents:number|null;
 sales:{count:number;total_cents:number;discount_cents:number;change_cents:number};
 payments:{method:string;amount_cents:number;sales:number}[];
 movements:{kind:string;amount_cents:number;count:number}[];
 refunds:{method:string;amount_cents:number}[]};
const MOVEMENT_LABELS:Record<string,string>={supply:'Reforço',withdrawal:'Sangria',refund:'Reembolso em dinheiro',
 credit_collection:'Recebimento de crediário',exchange_collection:'Diferença paga em troca',account_payment:'Pagamento de conta',
 commission_payment:'Pagamento de comissão'};
const when=(iso:string)=>new Date(iso).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});

/** Histórico de caixas: quem abriu e fechou, diferença na contagem e o resumo por forma de pagamento. */
export function CashHistory({session}:{session:Session}){
 const [items,setItems]=useState<CashRow[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [before,setBefore]=useState<string|null>(null);
 const [open,setOpen]=useState<string|null>(null),[summary,setSummary]=useState<Summary|null>(null);
 useEffect(()=>{
  const ctrl=new AbortController();setLoading(true);
  const query=new URLSearchParams({limit:'30',...(before?{before}:{})});
  void jsonRequest<{items:CashRow[]}>('/v1/cash-sessions?'+query,{headers:headers(session),signal:ctrl.signal},fetch)
   .then(out=>{if(!ctrl.signal.aborted)setItems(out.items);})
   .catch(e=>{if(!ctrl.signal.aborted)setError(errorText(e));})
   .finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
  return ()=>ctrl.abort();
 },[session,before]);
 useEffect(()=>{
  if(!open){setSummary(null);return;}
  const ctrl=new AbortController();setSummary(null);
  void jsonRequest<Summary>('/v1/cash-sessions/'+open+'/summary',{headers:headers(session),signal:ctrl.signal},fetch)
   .then(out=>{if(!ctrl.signal.aborted)setSummary(out);})
   .catch(e=>{if(!ctrl.signal.aborted)setError(errorText(e));});
  return ()=>ctrl.abort();
 },[session,open]);
 return <section className="management-section" aria-label="Histórico de caixas">
  <h2>Histórico de caixas</h2>
  <p>Cada abertura e fechamento, com a diferença entre o dinheiro esperado e o contado. Clique em um caixa para ver o resumo.</p>
  {loading&&<p role="status">Carregando caixas…</p>}
  {error&&<p role="alert" className="error">{error}</p>}
  <div className="management-table-scroll" role="region" aria-label="Caixas" tabIndex={0}>
   <table><thead><tr><th>Terminal</th><th>Aberto</th><th>Fechado</th><th>Vendas</th><th>Diferença</th><th></th></tr></thead>
   <tbody>{items.map(c=>{
    const diff=c.difference_cents===null?null:Number(c.difference_cents);
    return <tr key={c.id}>
     <td>{c.terminal_code}</td>
     <td>{when(c.opened_at)} · {c.opened_by}</td>
     <td>{c.closed_at?`${when(c.closed_at)} · ${c.closed_by??''}`:<strong>Aberto agora</strong>}</td>
     <td>{c.sale_count} · {brl(c.sales_cents)}</td>
     <td>{diff===null?'—':diff===0?'Sem diferença':<strong>{diff>0?'Sobra ':'Falta '}{brl(Math.abs(diff))}</strong>}
      {c.close_reason&&<small> · {c.close_reason}</small>}</td>
     <td><button className="light-button" onClick={()=>setOpen(open===c.id?null:c.id)}>{open===c.id?'Fechar resumo':'Ver resumo'}</button></td>
    </tr>;})}</tbody></table>
  </div>
  {items.length===30&&<button className="light-button" disabled={loading}
   onClick={()=>setBefore(items[items.length-1].opened_at)}>Caixas mais antigos</button>}
  {before&&<button className="light-button" disabled={loading} onClick={()=>setBefore(null)}>Voltar aos mais recentes</button>}
  {open&&!summary&&<p role="status">Carregando resumo…</p>}
  {summary&&<div className="editor-block" aria-label="Resumo do caixa">
   <h3>Resumo do caixa</h3>
   <dl className="management-kpis">
    <div><dt>Troco inicial</dt><dd>{brl(summary.opening_cents)}</dd></div>
    <div><dt>Vendas</dt><dd>{summary.sales.count} · {brl(summary.sales.total_cents)}</dd></div>
    <div><dt>Descontos dados</dt><dd>{brl(summary.sales.discount_cents)}</dd></div>
    <div><dt>Dinheiro esperado</dt><dd>{brl(summary.expected_cash_cents)}</dd></div>
    {summary.counted_cash_cents!==null&&<div><dt>Dinheiro contado</dt><dd>{brl(summary.counted_cash_cents)}</dd></div>}
   </dl>
   <h4>Recebido por forma de pagamento</h4>
   <ul>{summary.payments.map(p=><li key={p.method}>{METHOD_LABELS[p.method]??p.method}: {brl(p.amount_cents)} ({p.sales} vendas)</li>)}
    {summary.sales.change_cents>0&&<li>Troco devolvido: {brl(summary.sales.change_cents)}</li>}</ul>
   {summary.movements.length>0&&<><h4>Movimentos do caixa</h4>
    <ul>{summary.movements.map(m=><li key={m.kind}>{MOVEMENT_LABELS[m.kind]??m.kind}: {brl(m.amount_cents)} ({m.count})</li>)}</ul></>}
   {summary.refunds.length>0&&<><h4>Reembolsos</h4>
    <ul>{summary.refunds.map(r=><li key={r.method}>{METHOD_LABELS[r.method]??r.method}: {brl(r.amount_cents)}</li>)}</ul></>}
  </div>}
 </section>;
}
