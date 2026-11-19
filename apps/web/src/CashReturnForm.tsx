import { useRef,useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError,headers,jsonRequest } from './api-client.ts';
import type { Session } from './api-client.ts';
import { requestId } from './request-id.ts';

type Sale = {sale_number:string;status:string;total_cents:string;cash_only:boolean};
type Result = {id:string;refunded_cents:number};
const currency = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const message = (error:unknown) => error instanceof Error ? error.message : 'Falha ao consultar a venda';

export function CashReturnForm({session,cashId,onReturned}:{
  session:Session;cashId:string|null;onReturned:()=>void;
}) {
  const [number,setNumber] = useState('');
  const [sale,setSale] = useState<Sale|null>(null);
  const [reason,setReason] = useState('');
  const [confirmed,setConfirmed] = useState(false);
  const [error,setError] = useState('');
  const [result,setResult] = useState<Result|null>(null);
  const [busy,setBusy] = useState(false);
  const [uncertain,setUncertain] = useState(false);
  const pending = useRef<{body:string;key:string}|null>(null);

  async function lookup(event:FormEvent) {
    event.preventDefault();
    if(busy||uncertain)return;
    setBusy(true);
    setError('');
    setResult(null);
    setSale(null);
    setReason('');
    setConfirmed(false);
    try {
      setSale(await jsonRequest<Sale>('/v1/management/sales/by-number/'+encodeURIComponent(number.trim()),
        {headers:headers(session)},fetch));
    } catch(error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function record(event:FormEvent) {
    event.preventDefault();
    if(!sale||!cashId||busy||!confirmed)return;
    const body = JSON.stringify({cash_session_id:cashId,reason:reason.trim()});
    if(pending.current && pending.current.body!==body) {
      setError('Repita a devolução com o caixa e o motivo anteriores.');
      return;
    }
    const key = pending.current?.key ?? requestId();
    pending.current = {body,key};
    setError('');
    setBusy(true);
    try {
      const outcome = await jsonRequest<Result>('/v1/management/sales/by-number/'+sale.sale_number+'/cash-return',{
        method:'POST',headers:{...headers(session,key),'content-type':'application/json'},body,
      },fetch);
      pending.current = null;
      setUncertain(false);
      setSale(null);
      setResult(outcome);
      onReturned();
    } catch(error) {
      setError(message(error));
      if(error instanceof ApiError && error.status>=400 && error.status<500) {
        pending.current = null;
        setUncertain(false);
      } else setUncertain(true);
    } finally {
      setBusy(false);
    }
  }

  return <section>
    <h2>Devolução integral em dinheiro</h2>
    <form onSubmit={event=>void lookup(event)}>
      <label>Número da venda <input inputMode="numeric" pattern="[1-9][0-9]{0,15}" required
        value={number} onChange={event=>setNumber(event.target.value)} disabled={busy||uncertain}/></label>
      <button className="light-button" disabled={busy||uncertain}>Localizar venda</button>
    </form>
    {sale&&<div className="editor-block">
      <p>Venda nº {sale.sale_number} · {currency.format(Number(sale.total_cents)/100)}</p>
      {sale.status!=='confirmed' ? <p>Venda indisponível para devolução integral.</p>
        : !sale.cash_only ? <p>O pagamento desta venda inclui Pix ou cartão.</p>
        : <form onSubmit={event=>void record(event)}>
          <label>Motivo da devolução <input required minLength={8} maxLength={250}
            value={reason} onChange={event=>setReason(event.target.value)} disabled={busy||uncertain}/></label>
          <label><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}
            disabled={busy||uncertain}/> Conferi todas as peças e autorizo a devolução integral</label>
          <button className="primary-action" disabled={!cashId||busy||!confirmed}>
            {uncertain?'Repetir registro de devolução':'Registrar devolução'}
          </button>
          {!cashId&&<p>Abra o caixa para registrar a saída em dinheiro.</p>}
        </form>}
    </div>}
    {result&&<p role="status">Devolução registrada. Entregue {currency.format(result.refunded_cents/100)} em dinheiro. Protocolo {result.id}.</p>}
    {error&&<p role="alert" className="error">{error}</p>}
  </section>;
}
