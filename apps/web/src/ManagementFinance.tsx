import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {headers,jsonRequest} from './api-client.ts';
import type {Session} from './api-client.ts';
import {brl,errorText,parseReais,sendOnce} from './idempotent-post.ts';
import type {Pending} from './idempotent-post.ts';

type Expense={id:string;category:string;description:string;amount_cents:string;occurred_on:string;
 voided_at:string|null;void_reason:string|null;from_payable:boolean};
type Draft={date:string;category:string;description:string;amount:string};
const today=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
const blank=():Draft=>({date:today(),category:'',description:'',amount:''});
const toReais=(cents:string)=>(Number(cents)/100).toFixed(2).replace('.',',');
const PAGE=50;

/**
 * Despesas do mês: lançar, corrigir e estornar. O resultado do mês (DRE) fica logo abaixo, numa
 * única tela, para que vendas, devoluções e despesas sejam somadas sempre do mesmo jeito.
 */
export function ManagementFinance({session}:{session:Session}){
 const [month,setMonth]=useState(today().slice(0,7));
 const [items,setItems]=useState<Expense[]>([]),[total,setTotal]=useState(0),[offset,setOffset]=useState(0);
 const [showVoided,setShowVoided]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [loading,setLoading]=useState(false),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false);
 const [draft,setDraft]=useState<Draft>(blank());
 const [editing,setEditing]=useState<string|null>(null);
 const [voiding,setVoiding]=useState<string|null>(null),[voidReason,setVoidReason]=useState('');
 const pending=useRef<Pending>(null);
 useEffect(()=>{setOffset(0);},[month,showVoided]);
 useEffect(()=>{
  const ctrl=new AbortController();setLoading(true);setError('');
  const query=new URLSearchParams({month,limit:String(PAGE),offset:String(offset),include_voided:String(showVoided)});
  void jsonRequest<{items:Expense[];total:number}>('/v1/management/expenses?'+query,{headers:headers(session),signal:ctrl.signal},fetch)
   .then(out=>{if(!ctrl.signal.aborted){setItems(out.items);setTotal(out.total);}})
   .catch(e=>{if(!ctrl.signal.aborted)setError(errorText(e));})
   .finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
  return ()=>ctrl.abort();
 },[session,month,offset,showVoided,revision]);

 async function save(event:FormEvent){
  event.preventDefault();if(busy)return;
  let cents:number;
  try{cents=parseReais(draft.amount);if(cents<1)throw new Error('Informe um valor maior que zero.');}
  catch(e){setError(errorText(e));return;}
  const payload={amount_cents:cents,category:draft.category.trim(),description:draft.description.trim(),occurred_on:draft.date};
  setBusy(true);setError('');setNotice('');
  try{
   if(editing)await sendOnce(session,'PUT','/v1/management/expenses/'+editing,payload,pending);
   else await sendOnce(session,'POST','/v1/management/expenses',payload,pending);
   setNotice(editing?'Despesa corrigida.':'Despesa registrada.');
   setDraft(blank());setEditing(null);setRevision(n=>n+1);
  }catch(e){setError(errorText(e)+(pending.current?' Repita com os mesmos dados para não duplicar.':''));}
  finally{setBusy(false);}
 }
 async function voidExpense(id:string){
  if(busy||voidReason.trim().length<8)return;
  setBusy(true);setError('');setNotice('');
  try{
   await sendOnce(session,'POST','/v1/management/expenses/'+id+'/void',{reason:voidReason.trim()},pending);
   setNotice('Despesa estornada. Ela deixa de contar no resultado do mês.');
   setVoiding(null);setVoidReason('');setRevision(n=>n+1);
  }catch(e){setError(errorText(e));}
  finally{setBusy(false);}
 }
 function startEdit(item:Expense){
  setEditing(item.id);setVoiding(null);pending.current=null;
  setDraft({date:item.occurred_on.slice(0,10),category:item.category,description:item.description,amount:toReais(item.amount_cents)});
 }
 const field=(key:keyof Draft)=>(e:{target:{value:string}})=>setDraft(d=>({...d,[key]:e.target.value}));
 return <section className="management-section" aria-label="Despesas">
  <h2>Despesas</h2>
  <p>Controle gerencial. O resultado do mês aparece no DRE logo abaixo. Não substitui contabilidade nem documento fiscal.</p>
  <label>Mês <input type="month" value={month} onChange={e=>setMonth(e.target.value||today().slice(0,7))}/></label>
  <h3>{editing?'Corrigir despesa':'Lançar despesa'}</h3>
  <form className="management-form" onSubmit={e=>void save(e)}>
   <label>Data<input type="date" value={draft.date} onChange={field('date')} required/></label>
   <label>Categoria<input maxLength={80} required placeholder="Aluguel, energia, frete…" value={draft.category} onChange={field('category')}/></label>
   <label>Descrição<input maxLength={240} required value={draft.description} onChange={field('description')}/></label>
   <label>Valor (R$)<input inputMode="decimal" placeholder="0,00" required value={draft.amount} onChange={field('amount')}/></label>
   <button className="primary-action" disabled={busy}>{busy?'Salvando…':editing?'Salvar correção':'Registrar despesa'}</button>
   {editing&&<button type="button" className="light-button" disabled={busy}
    onClick={()=>{setEditing(null);setDraft(blank());pending.current=null;}}>Cancelar correção</button>}
  </form>
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}
  <h3>Despesas do mês ({total})</h3>
  <label><input type="checkbox" checked={showVoided} onChange={e=>setShowVoided(e.target.checked)}/> Mostrar estornadas</label>
  {loading&&<p role="status">Carregando despesas…</p>}
  <div className="management-table-scroll" role="region" aria-label="Despesas registradas" tabIndex={0}>
   <table><thead><tr><th>Data</th><th>Categoria</th><th>Descrição</th><th>Valor</th><th>Ações</th></tr></thead>
   <tbody>{items.map(item=><tr key={item.id} className={item.voided_at?'muted':''}>
    <td>{item.occurred_on.slice(0,10).split('-').reverse().join('/')}</td><td>{item.category}</td>
    <td>{item.description}{item.voided_at&&<small> · estornada: {item.void_reason}</small>}</td>
    <td>{item.voided_at?<s>{brl(item.amount_cents)}</s>:brl(item.amount_cents)}</td>
    <td>{item.voided_at?null:item.from_payable?<small>Corrija pela conta a pagar</small>:voiding===item.id?<span>
      <input aria-label="Motivo do estorno" placeholder="Motivo (mín. 8 letras)" maxLength={240} value={voidReason}
       onChange={e=>setVoidReason(e.target.value)}/>
      <button className="light-button" disabled={busy||voidReason.trim().length<8} onClick={()=>void voidExpense(item.id)}>Confirmar estorno</button>
      <button className="light-button" disabled={busy} onClick={()=>setVoiding(null)}>Voltar</button>
     </span>:<span>
      <button className="light-button" disabled={busy} onClick={()=>startEdit(item)}>Corrigir</button>{' '}
      <button className="light-button" disabled={busy} onClick={()=>{setVoiding(item.id);setVoidReason('');setEditing(null);pending.current=null;}}>Estornar</button>
     </span>}</td>
   </tr>)}</tbody></table>
  </div>
  {total>PAGE&&<p>
   <button className="light-button" disabled={offset===0||loading} onClick={()=>setOffset(o=>Math.max(0,o-PAGE))}>Anteriores</button>{' '}
   {offset+1}–{Math.min(offset+PAGE,total)} de {total}{' '}
   <button className="light-button" disabled={offset+PAGE>=total||loading} onClick={()=>setOffset(o=>o+PAGE)}>Próximas</button>
  </p>}
 </section>;
}
