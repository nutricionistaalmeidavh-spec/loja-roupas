import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, headers, jsonRequest } from './api-client.ts';
import type { Session } from './api-client.ts';
import { requestId } from './request-id.ts';

export type PickupLine = {variant_id:string;quantity:number};
export type PickupOrder = {id:string;quoted_total_cents:string;lines:PickupLine[]};
export type PublicPickupOrder = Pick<PickupOrder,'id'|'quoted_total_cents'>;
const message = (error:unknown) => error instanceof Error ? error.message : 'Falha na operação';

export function PickupSettings({session}:{session:Session}) {
  const [pending,setPending] = useState(false);
  const [feedback,setFeedback] = useState('');
  const retry = useRef<{enabled:boolean;key:string}|null>(null);
  async function change(enabled:boolean) {
    if (pending) return;
    setPending(true);
    setFeedback('');
    const key = retry.current?.enabled === enabled ? retry.current.key : requestId();
    retry.current = {enabled,key};
    try {
      await jsonRequest('/v1/management/storefront/pickup', {
        method:'PUT', headers:{...headers(session,key),'content-type':'application/json'}, body:JSON.stringify({enabled}),
      }, fetch);
      retry.current = null;
      setFeedback(enabled?'Pedidos para retirada ativados.':'Novos pedidos para retirada pausados.');
    } catch (error) {
      setFeedback(message(error));
    } finally {
      setPending(false);
    }
  }
  return <section>
    <h2>Pedidos para retirada</h2>
    <div className="publication-actions">
      <button type="button" className="light-button" disabled={pending} onClick={()=>void change(true)}>Ativar pedidos</button>
      <button type="button" className="light-button" disabled={pending} onClick={()=>void change(false)}>Pausar pedidos</button>
    </div>
    {feedback && <p role="status">{feedback}</p>}
  </section>;
}

export function PickupLookup({session,onLoaded}:{session:Session;onLoaded:(order:PickupOrder)=>void}) {
  const [code,setCode] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  async function load(event:FormEvent) {
    event.preventDefault();
    const id = code.trim();
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) {
      setError('Informe o código completo de retirada.');
      return;
    }
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      onLoaded(await jsonRequest<PickupOrder>('/v1/pickup-orders/'+id,{headers:headers(session)},fetch));
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return <form className="pickup-lookup publication-actions" onSubmit={event=>void load(event)}>
    <label>Código de retirada <input value={code} required onChange={event=>setCode(event.target.value)} disabled={busy}/></label>
    <button className="light-button" disabled={busy}>Abrir pedido</button>
    {error && <p role="alert" className="error">{error}</p>}
  </form>;
}

export function usePickupSubmission(storeId:string) {
  const [submitting,setSubmitting] = useState(false);
  const [order,setOrder] = useState<PublicPickupOrder|null>(null);
  const [error,setError] = useState('');
  const pending = useRef<{body:string;id:string}|null>(null);

  async function submit(lines:PickupLine[]) {
    if (submitting || !lines.length) return;
    setSubmitting(true);
    setError('');
    const body = JSON.stringify(lines);
    const id = pending.current?.body === body ? pending.current.id : requestId();
    pending.current = {body,id};
    try {
      const result = await jsonRequest<PublicPickupOrder>('/v1/storefront/'+storeId+'/pickup-orders', {
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({request_id:id,lines}),
      }, fetch);
      pending.current = null;
      setOrder(result);
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) pending.current = null;
      setError(message(error));
    } finally {
      setSubmitting(false);
    }
  }

  return {submitting,order,error,submit};
}

const pickupStatuses = {
  pending:'Pedido recebido. Apresente o código no caixa dentro do prazo de retirada.',
  cancelled:'Pedido cancelado pela loja.',
  complete:'Pedido concluído no caixa.',
  expired:'Prazo de retirada encerrado.',
};

export function PickupTracking({storeId,orderId}:{storeId:string;orderId?:string}) {
  const [code,setCode]=useState(orderId??'');
  const [feedback,setFeedback]=useState('');
  const [busy,setBusy]=useState(false);

  async function track(event:FormEvent) {
    event.preventDefault();
    const id=code.trim();
    if(busy)return;
    if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)){
      setFeedback('Informe o código completo de retirada.');
      return;
    }
    setBusy(true);setFeedback('');
    try{
      const result=await jsonRequest<{status:keyof typeof pickupStatuses}>(
        '/v1/storefront/'+storeId+'/pickup-orders/'+id+'/status',{},fetch);
      setFeedback(pickupStatuses[result.status]);
    }catch(error){setFeedback(message(error));}
    finally{setBusy(false);}
  }

  return <section>
    <h2>Acompanhar retirada</h2>
    <form onSubmit={event=>void track(event)}>
      <label>Código do pedido <input required value={code} onChange={event=>setCode(event.target.value)} disabled={busy}/></label>
      <button className="light-button" disabled={busy}>Consultar pedido</button>
    </form>
    {feedback&&<p role="status">{feedback}</p>}
  </section>;
}
