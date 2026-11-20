import { requestId } from './request-id.ts';
import { useEffect,useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError } from './api-client.ts';
import type { Session } from './api-client.ts';
import { currentCash,openCash,closeCash,moveCash } from './pos-client.ts';
import type { CashState } from './pos-client.ts';
import { reaisToCents } from './catalog-model.ts';
import { AppDialog } from './AppDialog.tsx';

const currency=(c:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(c/100);
export function CashPanel({session,onChanged}:{session:Session;onChanged:()=>void}){
 const [cash,setCash]=useState<CashState|null>(null),[status,setStatus]=useState(''),[error,setError]=useState('');
 const [loading,setLoading]=useState(true);
 const [opening,setOpening]=useState('0,00'),[counted,setCounted]=useState('0,00'),[reason,setReason]=useState('');
 const [kind,setKind]=useState<'supply'|'withdrawal'>('supply'),[amount,setAmount]=useState('');
 const [busy,setBusy]=useState(false),[key,setKey]=useState<string|null>(null);
 const [pendingSignature,setPendingSignature]=useState('');
 const [dialog,setDialog]=useState<'open'|'movement'|'close'|null>(null);
 const [closeAcknowledged,setCloseAcknowledged]=useState(false);
 const [refresh,setRefresh]=useState(0);
 const active=cash?.active?cash:null;
 useEffect(()=>{
  setLoading(true);
  const controller=new AbortController(); // resultado assíncrono é descartado se componente desmontar
  void currentCash(session).then(result=>{if(!controller.signal.aborted)setCash(result);})
    .catch(err=>{if(!controller.signal.aborted)setError(err instanceof Error?err.message:'Caixa indisponível');})
    .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[session,refresh]);
 async function perform(event:FormEvent,action:'open'|'close'|'movement'){
  event.preventDefault();if(busy)return;
  setError('');setStatus('');
  let signature:string;
  try {
   signature=action==='open'?JSON.stringify({action,opening})
    :action==='close'?JSON.stringify({action,counted,reason})
    :JSON.stringify({action,kind,amount,reason});
   if(action!=='open'&&!active)throw new Error('Caixa ainda não foi aberto');
  }catch(err){setError(String(err));return;}
  if(key&&pendingSignature!==signature){setError('Existe uma operação pendente. Repita sem alterar os campos.');return;}
  const nextKey=key??requestId();setKey(nextKey);setPendingSignature(signature);setBusy(true);
  try{
   if(action==='open')await openCash(session,reaisToCents(opening),'CAIXA-01',nextKey);
   if(action==='close')await closeCash(session,active!.id,reaisToCents(counted),reason,nextKey);
   if(action==='movement')await moveCash(session,active!.id,kind,reaisToCents(amount),reason,nextKey);
   setStatus(action==='open'?'Caixa aberto.':action==='close'?'Caixa fechado.':'Movimento de caixa registrado.');
   setKey(null);setPendingSignature('');setRefresh(x=>x+1);onChanged();
   setReason('');setAmount('');setDialog(null);setCloseAcknowledged(false);
  }catch(err){
   setError(err instanceof Error?err.message:'Erro no caixa');
   if(err instanceof ApiError&&err.status>=400&&err.status<500){setKey(null);setPendingSignature('');}
  }finally{setBusy(false);}
 }

 if(loading)return <p className="notice" role="status">Consultando caixa…</p>;
 return <section className="workspace-hub cash-workspace">
  <div className="hub-heading">
   <div><h2>Caixa da loja</h2><p>Terminal CAIXA-01 · Controle de abertura, sangrias, suprimentos e fechamento.</p></div>
   <div className="hub-actions">
    {active?<><button type="button" className="primary-action" onClick={()=>setDialog('movement')}>Nova movimentação</button>
     <button type="button" className="light-button" onClick={()=>setDialog('close')}>Fechar caixa</button></>
     :<button type="button" className="primary-action" onClick={()=>setDialog('open')}>Abrir caixa</button>}
   </div>
  </div>
  <div className="cash-summary">
   <span className={'cash-status '+(active?'active':'')}>{active?'Caixa aberto':'Caixa fechado'}</span>
   <div className="cash-stat">
    <span>Valor inicial</span><strong>{active?currency(active.opening_cents):'—'}</strong>
   </div>
   <div className="cash-stat">
    <span>Aberto em</span><strong>{active?new Date(active.opened_at).toLocaleString('pt-BR'):'Aguardando abertura'}</strong>
   </div>
  </div>
  {error&&<p className="error" role="alert">{error}</p>}
  {status&&<p className="notice" role="status">{status}</p>}
  {dialog==='open'&&!active&&<AppDialog title="Abrir caixa" locked={busy||Boolean(key)} onClose={()=>setDialog(null)}>
   <form className="cash-action-form" onSubmit={e=>void perform(e,'open')}>
    <p>Informe o valor em dinheiro conferido na gaveta antes de iniciar as vendas.</p>
    <label>Valor inicial (R$)<input required inputMode="decimal" autoFocus value={opening} disabled={busy} onChange={e=>setOpening(e.target.value)}/></label>
    {error&&<p className="error" role="alert">{error}</p>}
    <button type="submit" disabled={busy} className="primary-action">Confirmar abertura</button>
   </form>
  </AppDialog>}
  {dialog==='movement'&&active&&<AppDialog title="Movimentar caixa" locked={busy||Boolean(key)} onClose={()=>setDialog(null)}>
   <form className="cash-action-form" onSubmit={e=>void perform(e,'movement')}>
    <label>Operação<select value={kind} disabled={busy} onChange={e=>setKind(e.target.value as 'supply'|'withdrawal')}>
     <option value="supply">Suprimento (entrada)</option><option value="withdrawal">Sangria (retirada)</option>
    </select></label>
    <label>Valor (R$)<input required inputMode="decimal" placeholder="25,00" value={amount} disabled={busy} onChange={e=>setAmount(e.target.value)}/></label>
    <label>Motivo<input required minLength={8} maxLength={250} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
    {error&&<p className="error" role="alert">{error}</p>}
    <button type="submit" disabled={busy} className="primary-action">Registrar movimentação</button>
   </form>
  </AppDialog>}
  {dialog==='close'&&active&&<AppDialog title="Conferir e fechar caixa" locked={busy||Boolean(key)} onClose={()=>setDialog(null)}>
   <form className="cash-action-form" onSubmit={e=>void perform(e,'close')}>
    <p>Conte o dinheiro físico antes de confirmar. O fechamento encerra a sessão de venda atual.</p>
    <label>Dinheiro contado (R$)<input required inputMode="decimal" value={counted} disabled={busy} onChange={e=>setCounted(e.target.value)}/></label>
    <label>Justificativa para divergência<input maxLength={250} minLength={8} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
    <label className="cash-confirm"><input type="checkbox" checked={closeAcknowledged} disabled={busy} onChange={e=>setCloseAcknowledged(e.target.checked)}/>
     Conferi os valores e quero encerrar este caixa.</label>
    {error&&<p className="error" role="alert">{error}</p>}
    <button type="submit" disabled={busy||!closeAcknowledged} className="primary-action">Confirmar fechamento</button>
   </form>
  </AppDialog>}
 </section>;
}
