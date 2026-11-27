import { requestId } from './request-id.ts';
import { useEffect,useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError } from './api-client.ts';
import type { Session } from './api-client.ts';
import { currentCash,openCash,closeCash,moveCash } from './pos-client.ts';
import type { CashState } from './pos-client.ts';
import { reaisToCents } from './catalog-model.ts';
import { TaskDialog } from './TaskDialog.tsx';
import { ReprintReceipt } from './StoreOperations.tsx';
import { headers,jsonRequest } from './api-client.ts';

type CashSummary={expected_cash_cents:number;sales:{count:number;total_cents:number;change_cents:number};
 payments:Array<{method:string;amount_cents:number;sales:number}>;movements:Array<{kind:string;amount_cents:number;count:number}>;
 refunds:Array<{method:string;amount_cents:number}>};
const METHOD_LABEL:Record<string,string>={cash:'Dinheiro',pix_manual:'Pix',card_external:'Cartão',store_credit:'Crediário',customer_credit:'Crédito da cliente'};
/** O que a operadora mais pergunta: quanto deveria ter na gaveta e quanto vendeu em cada forma. */
function CashTurnSummary({session,cashId,refresh}:{session:Session;cashId:string;refresh:number}){
 const [summary,setSummary]=useState<CashSummary|null>(null);
 useEffect(()=>{
  const ctrl=new AbortController();
  void jsonRequest<CashSummary>('/v1/cash-sessions/'+cashId+'/summary',{headers:headers(session),signal:ctrl.signal},fetch)
   .then(s=>{if(!ctrl.signal.aborted)setSummary(s);}).catch(()=>{});
  return ()=>ctrl.abort();
 },[session,cashId,refresh]);
 if(!summary)return null;
 const move=(kind:string)=>summary.movements.find(m=>m.kind===kind);
 const refunded=summary.refunds.reduce((n,r)=>n+r.amount_cents,0);
 return <div className="cash-turn" aria-label="Resumo do turno" role="group">
  <div className="cash-drawer-now"><span>Deveria ter na gaveta agora</span><strong>{currency(summary.expected_cash_cents)}</strong></div>
  <dl className="cash-turn-grid">
   <div><dt>Vendas no turno</dt><dd>{summary.sales.count} · {currency(summary.sales.total_cents)}</dd></div>
   {summary.payments.map(p=><div key={p.method}><dt>{METHOD_LABEL[p.method]??p.method}</dt><dd>{currency(p.method==='cash'?p.amount_cents-summary.sales.change_cents:p.amount_cents)}</dd></div>)}
   <div><dt>Suprimentos</dt><dd>{move('supply')?.count??0} · {currency(move('supply')?.amount_cents??0)}</dd></div>
   <div><dt>Sangrias</dt><dd>{move('withdrawal')?.count??0} · {currency(move('withdrawal')?.amount_cents??0)}</dd></div>
   {refunded>0&&<div><dt>Devoluções</dt><dd>{currency(refunded)}</dd></div>}
  </dl>
 </div>;
}

const currency=(c:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(c/100);
export function CashPanel({session,onChanged}:{session:Session;onChanged:()=>void}){
 const [cash,setCash]=useState<CashState|null>(null),[status,setStatus]=useState(''),[error,setError]=useState('');
 const [loading,setLoading]=useState(true);
 const [opening,setOpening]=useState('0,00'),[counted,setCounted]=useState('0,00'),[reason,setReason]=useState('');
 const [kind,setKind]=useState<'supply'|'withdrawal'>('supply'),[amount,setAmount]=useState('');
 const [busy,setBusy]=useState(false),[key,setKey]=useState<string|null>(null);
 const [pendingSignature,setPendingSignature]=useState('');
 const [refresh,setRefresh]=useState(0);
 const [cashTask,setCashTask]=useState<'movement'|'close'|null>(null);
 const [ownedByOther,setOwnedByOther]=useState('');
 const [reprintOpen,setReprintOpen]=useState(false);
 const active=cash?.active?cash:null;
 useEffect(()=>{
  setLoading(true);
  const controller=new AbortController(); // resultado assíncrono é descartado se componente desmontar
  setOwnedByOther('');
  void currentCash(session).then(result=>{if(!controller.signal.aborted)setCash(result);})
    .catch(err=>{
      if(controller.signal.aborted)return;
      if(err instanceof ApiError&&err.code==='CASH_OWNER'){setCash(null);setOwnedByOther(err.message);return;}
      setError(err instanceof Error?err.message:'Caixa indisponível');
    })
    .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[session,refresh]);
 async function perform(event:FormEvent,action:'open'|'close'|'movement'){
  event.preventDefault();if(busy)return;
  setError('');setStatus('');
  let signature:string,cents:number;
  try {
   // Validação local ANTES de reservar a chave de idempotência: valor digitado errado
   // não pode deixar uma "operação pendente" que só some reabrindo o app.
   if(action!=='open'&&!active)throw new Error('Caixa ainda não foi aberto');
   cents=reaisToCents(action==='open'?opening:action==='close'?counted:amount);
   signature=action==='open'?JSON.stringify({action,cents})
    :action==='close'?JSON.stringify({action,cents,reason})
    :JSON.stringify({action,kind,cents,reason});
  }catch(err){setError(err instanceof Error?err.message:String(err));return;}
  if(key&&pendingSignature!==signature){setError('Existe uma operação pendente. Repita sem alterar os campos.');return;}
  const nextKey=key??requestId();setKey(nextKey);setPendingSignature(signature);setBusy(true);
  try{
   if(action==='open')await openCash(session,cents,'CAIXA-01',nextKey);
   if(action==='close')await closeCash(session,active!.id,cents,reason,nextKey);
   if(action==='movement')await moveCash(session,active!.id,kind,cents,reason,nextKey);
   setStatus(action==='open'?'Caixa aberto.':action==='close'?'Caixa fechado.':'Movimento de caixa registrado.');
   setKey(null);setPendingSignature('');setRefresh(x=>x+1);onChanged();
   setReason('');setAmount('');setCashTask(null);
  }catch(err){
   setError(err instanceof Error?err.message:'Erro no caixa');
   if(err instanceof ApiError&&err.status>=400&&err.status<500){setKey(null);setPendingSignature('');}
   if(err instanceof ApiError&&(err.code==='CASH_OWNER'||err.code==='CASH_ALREADY_OPEN')){setOwnedByOther(err.message);setRefresh(x=>x+1);}
  }finally{setBusy(false);}
 }
 if(loading)return <p className="notice" role="status">Consultando caixa…</p>;
 return <section className="management-form">
  <div className="form-heading"><h2>Operação de caixa</h2><p>Caixa CAIXA-01 · Abra no início do turno e feche no fim.</p></div>
  {ownedByOther?<div className="editor-block" role="status"><strong>{ownedByOther}</strong>
   <p>O CAIXA-01 já está aberto por outra pessoa. Para vender por aqui, peça para quem abriu fechar o caixa, ou peça ao gerente para fechá-lo na conferência.</p>
  </div>:active?<div className="editor-block"><strong>Caixa aberto</strong><p>Saldo inicial: {currency(active.opening_cents)}</p>
   <p className="muted small">Aberto em {new Date(active.opened_at).toLocaleString('pt-BR')}</p>
   <CashTurnSummary session={session} cashId={active.id} refresh={refresh}/>
  </div>:<form className="editor-block" onSubmit={e=>void perform(e,'open')}>
   <h3>Abrir caixa</h3>
   <label>Valor inicial (R$)<input required inputMode="decimal" value={opening} onChange={e=>setOpening(e.target.value)}/></label>
   <button disabled={busy} className="primary-action">Abrir caixa</button>
  </form>}
  {active&&<>
   <div className="cash-quick-actions">
     <button type="button" className="light-button" onClick={()=>{setError('');setStatus('');setCashTask('movement');}}>Sangria ou suprimento</button>
     <button type="button" className="primary-action" onClick={()=>{setError('');setStatus('');setCashTask('close');}}>Fechar caixa</button>
   </div>
   {cashTask==='movement'&&<TaskDialog title="Sangria ou suprimento" busy={busy||Boolean(key)} onClose={()=>{setCashTask(null);setError('');}}>
    <form className="editor-block" onSubmit={e=>void perform(e,'movement')}>
      <h3>Movimentação</h3>
      <label>Tipo<select value={kind} onChange={e=>setKind(e.target.value as 'supply'|'withdrawal')}>
        <option value="supply">Suprimento</option><option value="withdrawal">Sangria</option>
      </select></label>
      <label>Valor (R$)<input required inputMode="decimal" placeholder="25,00" value={amount}
        onChange={e=>setAmount(e.target.value)}/></label>
      <label>Justificativa<input required minLength={8} maxLength={250} value={reason} onChange={e=>setReason(e.target.value)}/></label>
      {error&&<p className="error" role="alert">{error}</p>}
      <button disabled={busy} className="primary-action">Registrar movimento</button>
    </form>
   </TaskDialog>}
   {cashTask==='close'&&<TaskDialog title="Fechar caixa" busy={busy||Boolean(key)} onClose={()=>{setCashTask(null);setError('');}}>
    <form className="editor-block" onSubmit={e=>void perform(e,'close')}>
      <h3>Conferência do caixa</h3>
      <p>Informe o dinheiro físico contado. Divergências exigem justificativa.</p>
      <label>Dinheiro contado (R$)<input required inputMode="decimal" value={counted}
        onChange={e=>setCounted(e.target.value)}/></label>
      <label>Justificativa em caso de divergência<input maxLength={250} minLength={8} value={reason}
        onChange={e=>setReason(e.target.value)}/></label>
      {error&&<p className="error" role="alert">{error}</p>}
      <button disabled={busy} className="primary-action">Fechar e conferir caixa</button>
    </form>
   </TaskDialog>}
  </>}
  <div className="cash-quick-actions">
   <button type="button" className="light-button" onClick={()=>setReprintOpen(true)}>Segunda via do cupom</button>
  </div>
  {reprintOpen&&<TaskDialog title="Segunda via do cupom" onClose={()=>setReprintOpen(false)}>
   <ReprintReceipt session={session}/>
  </TaskDialog>}
  {error&&!cashTask&&<p className="error" role="alert">{error}</p>}
  {status&&<p className="notice" role="status">{status}</p>}
 </section>;
}
