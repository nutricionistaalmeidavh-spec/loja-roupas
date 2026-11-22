import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {ApiError,headers,jsonRequest} from './api-client.ts';
import type {Session} from './api-client.ts';
import {requestId} from './request-id.ts';
type Expense={id:string;category:string;description:string;amount_cents:string;occurred_on:string};
type Balance={month:string;gross_cents:number;refunds_cents:number;expenses_cents:number;net_sales_cents:number;operational_balance_cents:number;note:string};
const brl=(value:number|string)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)/100);
const today=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
export function ManagementFinance({session}:{session:Session}){
 const [month,setMonth]=useState(today().slice(0,7)),[result,setResult]=useState<Balance|null>(null);
 const [items,setItems]=useState<Expense[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [loading,setLoading]=useState(false),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false);
 const pending=useRef<{body:string;key:string}|null>(null);
 useEffect(()=>{
  const ctrl=new AbortController();setLoading(true);setError('');
  void Promise.all([
   jsonRequest<Balance>('/v1/management/operational-result?month='+month,{headers:headers(session),signal:ctrl.signal},fetch),
   jsonRequest<{items:Expense[]}>('/v1/management/expenses',{headers:headers(session),signal:ctrl.signal},fetch)
  ]).then(([balance,expenses])=>{if(!ctrl.signal.aborted){setResult(balance);setItems(expenses.items);}})
   .catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Erro ao consultar despesas');})
   .finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
  return ()=>ctrl.abort();
 },[session,month,revision]);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;
  const form=event.currentTarget;
  const value=String(new FormData(form).get('amount')||'').trim().replace(',','.');
  if(!/^\d+(?:\.\d{1,2})?$/.test(value)){setError('Informe um valor válido em reais.');return;}
  const cents=Math.round(Number(value)*100);
  if(!Number.isSafeInteger(cents)||cents<1){setError('Valor inválido.');return;}
  const raw=new FormData(form);
  const body=JSON.stringify({amount_cents:cents,category:String(raw.get('category')),description:String(raw.get('description')),occurred_on:String(raw.get('date'))});
  const key=pending.current?.body===body?pending.current.key:requestId();pending.current={key,body};
  setBusy(true);setError('');setNotice('');
  try{
   await jsonRequest('/v1/management/expenses',{method:'POST',headers:{...headers(session,key),'content-type':'application/json'},body},fetch);
   pending.current=null;form.reset();setNotice('Despesa registrada.');setRevision(n=>n+1);
  }catch(e){
   if(e instanceof ApiError&&e.status>=400&&e.status<500)pending.current=null;
   setError(e instanceof Error?e.message:'Falha ao registrar despesa; repita com os mesmos dados.');
  }finally{setBusy(false);}
 }
 return <section className="management-section" aria-label="Despesas e resultado operacional">
  <h2>Despesas e resultado operacional</h2>
  <p>Controle gerencial local. Não substitui DRE contábil, conciliação bancária nem documento fiscal.</p>
  <label>Mês de referência <input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label>
  {loading&&<p role="status">Carregando resultados…</p>}
  {result&&<dl className="management-kpis">
   <div><dt>Vendas brutas</dt><dd>{brl(result.gross_cents)}</dd></div>
   <div><dt>Devoluções</dt><dd>{brl(result.refunds_cents)}</dd></div>
   <div><dt>Despesas</dt><dd>{brl(result.expenses_cents)}</dd></div>
   <div><dt>Saldo gerencial parcial</dt><dd>{brl(result.operational_balance_cents)}</dd></div>
  </dl>}
  <h3>Lançar despesa</h3>
  <form className="management-form" onSubmit={e=>void submit(e)}>
   <label>Data<input name="date" type="date" defaultValue={today()} required/></label>
   <label>Categoria<input name="category" maxLength={80} required placeholder="Aluguel, energia, frete…"/></label>
   <label>Descrição<input name="description" maxLength={240} required/></label>
   <label>Valor (R$)<input name="amount" inputMode="decimal" placeholder="0,00" required/></label>
   <button className="primary-action" disabled={busy}>{busy?'Registrando…':'Registrar despesa'}</button>
  </form>
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}
  <h3>Últimas despesas (até 100)</h3>
  <div className="management-table-scroll" role="region" aria-label="Despesas registradas" tabIndex={0}>
   <table><thead><tr><th>Data</th><th>Categoria</th><th>Descrição</th><th>Valor</th></tr></thead>
   <tbody>{items.map(item=><tr key={item.id}><td>{item.occurred_on}</td><td>{item.category}</td><td>{item.description}</td><td>{brl(item.amount_cents)}</td></tr>)}</tbody></table>
  </div>
 </section>;
}
