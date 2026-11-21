import {useEffect,useState} from 'react';
import type {OperationalSummary,OperationalCounts} from '@loja/domain/operations';
import {ApiError,headers,jsonRequest} from './api-client.ts';
import type {Session} from './api-client.ts';

type ActionTarget='operacoes'|'posvenda';
const actions:ReadonlyArray<{
  count:keyof OperationalCounts;label:string;detail:string;action:string;target:ActionTarget;
}>= [
  {count:'purchases_to_receive',label:'Compras por conferir',detail:'Aprovar peças antes de disponibilizar no estoque',
    action:'Conferir compras',target:'operacoes'},
  {count:'pickups_pending',label:'Retiradas pendentes',detail:'Pedidos aguardando atendimento na loja',
    action:'Ver retiradas',target:'operacoes'},
  {count:'print_jobs_pending',label:'Impressões pendentes',detail:'Comprovantes aguardando confirmação de impressão',
    action:'Abrir fila',target:'operacoes'},
  {count:'holds_active',label:'Reservas ativas',detail:'Peças temporariamente indisponíveis para venda',
    action:'Revisar reservas',target:'posvenda'},
  {count:'partially_returned_sales',label:'Vendas devolvidas parcialmente',
    detail:'Vendas que ainda têm itens devolvíveis',action:'Abrir pós-venda',target:'posvenda'},
];

/** A fonte dos indicadores é somente a API da loja; sem cálculo por estado de telas. */
export function OperationsActionCenter({session,revision=0,onNavigate}:{
  session:Session;revision?:number;onNavigate:(target:ActionTarget)=>void;
}){
  const [data,setData]=useState<OperationalSummary|null>(null);
  const [error,setError]=useState('');
  const [forbidden,setForbidden]=useState(false);
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    void jsonRequest<OperationalSummary>('/v1/management/operations/summary',{
      headers:headers(session),signal:controller.signal},fetch).then(result=>{
      if(controller.signal.aborted)return;
      setData(result);setError('');setForbidden(false);
    }).catch(cause=>{
      if(controller.signal.aborted)return;
      if(cause instanceof ApiError&&cause.status===403){setForbidden(true);return;}
      setError(cause instanceof Error?cause.message:'Não foi possível carregar tarefas');setData(null);
    });
    return ()=>controller.abort();
  },[session,revision,refresh]);
  if(forbidden)return null;
  const c=data?.counts;
  const alerts=c?[
    {label:'Peças reprovadas em compras',count:c.purchase_quarantine_units},
    {label:'Peças não entregues',count:c.purchase_missing_units},
    {label:'Devoluções em quarentena',count:c.returned_quarantine_units},
    {label:'Variantes com estoque baixo',count:c.low_stock_variants},
  ]:[];
  return <section className="operations-overview" role="region" aria-label="Central de ações">
    <header className="operations-overview-head">
      <div><h2>Central de ações</h2>
        <p>O que exige atenção na operação desta loja. Contagens calculadas no banco local.</p>
      </div>
      <button className="light-button" type="button" onClick={()=>setRefresh(n=>n+1)}>
        Atualizar tarefas
      </button>
    </header>
    {!data&&!error&&<p role="status">Consultando tarefas da loja…</p>}
    {error&&<p role="alert">{error} <button className="light-button" onClick={()=>setRefresh(n=>n+1)}>Tentar novamente</button></p>}
    {c&&<div className="operations-overview-grid">
      {actions.map(item=><article key={item.count} className="operations-overview-item">
        <span>{item.label}</span>
        <strong>{c[item.count].toLocaleString('pt-BR')}</strong>
        <p>{item.detail}</p>
        <button className="light-button" type="button" onClick={()=>onNavigate(item.target)}>
          {item.action}
        </button>
      </article>)}
    </div>}
    {c&&<div className="operations-overview-alerts" role="group" aria-label="Ocorrências de estoque">
      <strong>Exceções registradas</strong>
      <div>{alerts.map(item=><span key={item.label}>{item.label}: <b>{item.count.toLocaleString('pt-BR')}</b></span>)}</div>
      <p>Quarentena e faltas são registros de conferência, não representam estoque disponível.</p>
    </div>}
  </section>;
}
