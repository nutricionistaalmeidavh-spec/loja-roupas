import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {ApiError,headers,jsonRequest} from './api-client.ts';
import type {Session} from './api-client.ts';
import {requestId} from './request-id.ts';

type SaleLine={id:string;product_name:string;sku:string;color:string;size:string;quantity:number;
 unit_price_cents:number;returned_quantity:number;available_to_return:number};
type Sale={sale_number:string;status:string;total_cents:string;cash_only:boolean;lines:SaleLine[]};
type Result={id:string;refunded_cents:number;status:string};
type Selection={quantity:string;condition:'resellable'|'quarantine'};
const currency=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const money=(cents:number)=>currency.format(cents/100);
const message=(error:unknown)=>error instanceof Error?error.message:'Falha na operação';

export function CashReturnForm({session,cashId,onReturned,onLockChange}:{
 session:Session;cashId:string|null;onReturned:()=>void;onLockChange?:(locked:boolean)=>void;
}){
 const [number,setNumber]=useState('');
 const [sale,setSale]=useState<Sale|null>(null);
 const [selection,setSelection]=useState<Record<string,Selection>>({});
 const [reason,setReason]=useState('');
 const [confirmed,setConfirmed]=useState(false);
 const [error,setError]=useState('');
 const [result,setResult]=useState<Result|null>(null);
 const [busy,setBusy]=useState(false);
 const [uncertain,setUncertain]=useState(false);
 const pending=useRef<{body:string;key:string}|null>(null);
 useEffect(()=>{onLockChange?.(busy||uncertain);return ()=>onLockChange?.(false);},[busy,uncertain,onLockChange]);

 async function lookup(event:FormEvent){
  event.preventDefault();
  if(busy||uncertain)return;
  setBusy(true);setError('');setResult(null);setSale(null);
  setReason('');setConfirmed(false);setSelection({});pending.current=null;
  try{
   const fetched=await jsonRequest<Sale>('/v1/management/sales/by-number/'+encodeURIComponent(number.trim()),
    {headers:headers(session)},fetch);
   setSale(fetched);
   setSelection(Object.fromEntries(fetched.lines.map(line=>[line.id,{quantity:'0',condition:'resellable'}])));
  }catch(err){setError(message(err));}
  finally{setBusy(false);}
 }
 function select(id:string,update:Partial<Selection>){
  setSelection(current=>({...current,[id]:{...current[id],...update}}));
 }
 const items=(sale?.lines??[]).flatMap(line=>{
  const entry=selection[line.id];
  if(!entry)return [];
  const quantity=Number(entry.quantity);
  return Number.isSafeInteger(quantity)&&quantity>0&&quantity<=line.available_to_return
   ?[{sale_line_id:line.id,quantity,condition:entry.condition}]:[];
 });
 const invalid=(sale?.lines??[]).some(line=>{
  const quantity=Number(selection[line.id]?.quantity??'0');
  return !Number.isSafeInteger(quantity)||quantity<0||quantity>line.available_to_return;
 });
 const refundTotal=items.reduce((sum,item)=>{
  const line=sale?.lines.find(line=>line.id===item.sale_line_id);
  return sum+(line?.unit_price_cents??0)*item.quantity;
 },0);
 async function record(event:FormEvent){
  event.preventDefault();
  if(!sale||!cashId||busy||!confirmed||invalid||!items.length)return;
  const body=JSON.stringify({cash_session_id:cashId,reason:reason.trim(),items});
  if(pending.current&&pending.current.body!==body){
   setError('A devolução está pendente. Não altere a seleção antes da recuperação.');return;
  }
  const key=pending.current?.key??requestId();
  pending.current={body,key};
  setError('');setBusy(true);
  try{
   const outcome=await jsonRequest<Result>('/v1/management/sales/by-number/'+sale.sale_number+'/cash-return',{
    method:'POST',headers:{...headers(session,key),'content-type':'application/json'},body
   },fetch);
   pending.current=null;setUncertain(false);setResult(outcome);setSale(null);
   onReturned();
  }catch(err){
   setError(message(err));
   if(err instanceof ApiError&&err.status>=400&&err.status<500){
    pending.current=null;setUncertain(false);
   }else setUncertain(true);
  }finally{setBusy(false);}
 }
 return <section>
  <h2>Devolução de peças — pagamento em dinheiro</h2>
  <p className="muted">Localize a venda, selecione apenas as peças recebidas e registre a condição física. Peças avariadas ficam fora do estoque vendável.</p>
  <form onSubmit={event=>void lookup(event)}>
   <label>Número da venda
    <input inputMode="numeric" pattern="[1-9][0-9]{0,15}" required value={number}
     onChange={event=>setNumber(event.target.value)} disabled={busy||uncertain}/></label>
   <button type="submit" className="light-button" disabled={busy||uncertain}>Localizar venda</button>
  </form>
  {sale&&<div className="editor-block">
    <h3>Venda nº {sale.sale_number} · {money(Number(sale.total_cents))}</h3>
    {!['confirmed','partially_returned'].includes(sale.status)?<p role="status">Esta venda não possui peças disponíveis para devolução.</p>:
    !sale.cash_only?<p role="status">Esta venda inclui Pix ou cartão. A devolução exige conciliação externa; não é possível registrar saída em dinheiro neste fluxo.</p>:
    <form onSubmit={event=>void record(event)}>
     <fieldset disabled={busy||uncertain}>
      <legend>Selecionar itens e condição</legend>
      {sale.lines.map(line=><div className="editor-block" key={line.id}>
       <strong>{line.product_name} · {line.color} / {line.size}</strong>
       <p className="muted small">SKU {line.sku} · {money(line.unit_price_cents)} cada · {line.available_to_return} restantes de {line.quantity}</p>
       <div className="fields-two">
        <label>Quantidade a devolver
         <input type="number" min={0} max={line.available_to_return} inputMode="numeric"
          value={selection[line.id]?.quantity??'0'} disabled={line.available_to_return===0}
          onChange={event=>select(line.id,{quantity:event.target.value})}/></label>
        <label>Condição física
         <select value={selection[line.id]?.condition??'resellable'} disabled={line.available_to_return===0}
          onChange={event=>select(line.id,{condition:event.target.value as Selection['condition']})}>
          <option value="resellable">Aprovada para revenda</option>
          <option value="quarantine">Avariada / quarentena</option>
         </select></label>
       </div>
      </div>)}
     </fieldset>
     <p role="status">Peças selecionadas: {items.reduce((n,i)=>n+i.quantity,0)} · Reembolso: <strong>{money(refundTotal)}</strong></p>
     <label>Motivo da devolução
      <input required minLength={8} maxLength={250} value={reason} disabled={busy||uncertain}
       onChange={event=>setReason(event.target.value)}/></label>
     <label><input type="checkbox" checked={confirmed} disabled={busy||uncertain}
      onChange={event=>setConfirmed(event.target.checked)}/> Conferi fisicamente os itens e o valor do reembolso</label>
     <button type="submit" className="primary-action"
      disabled={!cashId||busy||!confirmed||invalid||items.length===0}>
      {uncertain?'Repetir solicitação sem duplicar':'Registrar devolução e reembolso'}
     </button>
     {!cashId&&<p role="alert">Abra o caixa antes de registrar a devolução.</p>}
    </form>}
   </div>}
  {result&&<p role="status">Devolução registrada. Reembolso de {money(result.refunded_cents)} em dinheiro. Situação: {result.status==='returned'?'devolução concluída':'devolução parcial'}.</p>}
  {error&&<p role="alert" className="error">{error}{uncertain?' O resultado pode ter sido gravado; não gere outra devolução.':''}</p>}
 </section>;
}
