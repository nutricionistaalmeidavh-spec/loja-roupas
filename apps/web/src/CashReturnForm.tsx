import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import type {SaleReturnLookup} from '@loja/domain/operations';
import {headers,jsonRequest} from './api-client.ts';
import type {Session} from './api-client.ts';
import {brl,errorText,METHOD_LABELS,parseReais,sendOnce} from './idempotent-post.ts';
import type {Pending} from './idempotent-post.ts';

type Sale=SaleReturnLookup;
type Selection={quantity:string;condition:'resellable'|'quarantine'};
type Item={sale_line_id:string;quantity:number;condition:Selection['condition']};
type Preview={amount_cents:number;refundable:Record<string,number>;suggested:{method:string;amount_cents:number}[]};
type PartDraft={amount:string;reference:string};
type Result={id:string;refunded_cents:number;status:string;customer_credit_cents:number;parts:{method:string;amount_cents:number}[]};
const ORDER=['store_credit','customer_credit','card_external','pix_manual','cash'];
const needsReference=(method:string)=>method==='pix_manual'||method==='card_external';
const centsText=(cents:number)=>cents?(cents/100).toFixed(2).replace('.',','):'';

/**
 * Devolução de peças com reembolso dividido. O sistema sugere devolver primeiro o que ficou em
 * aberto no crediário, depois cartão, Pix e por último dinheiro — nunca mais do que foi pago em cada meio.
 */
export function CashReturnForm({session,cashId,onReturned,onLockChange}:{
 session:Session;cashId:string|null;onReturned:()=>void;onLockChange?:(locked:boolean)=>void;
}){
 const [number,setNumber]=useState('');
 const [sale,setSale]=useState<Sale|null>(null);
 const [selection,setSelection]=useState<Record<string,Selection>>({});
 const [preview,setPreview]=useState<Preview|null>(null);
 const [parts,setParts]=useState<Record<string,PartDraft>>({});
 const [reason,setReason]=useState('');
 const [confirmed,setConfirmed]=useState(false);
 const [error,setError]=useState('');
 const [result,setResult]=useState<Result|null>(null);
 const [busy,setBusy]=useState(false);
 const [uncertain,setUncertain]=useState(false);
 const pending=useRef<Pending>(null);
 useEffect(()=>{onLockChange?.(busy||uncertain);return ()=>onLockChange?.(false);},[busy,uncertain,onLockChange]);

 async function lookup(event:FormEvent){
  event.preventDefault();
  if(busy||uncertain)return;
  setBusy(true);setError('');setResult(null);setSale(null);setPreview(null);setParts({});
  setReason('');setConfirmed(false);setSelection({});pending.current=null;
  try{
   const fetched=await jsonRequest<Sale>('/v1/management/sales/by-number/'+encodeURIComponent(number.trim()),
    {headers:headers(session)},fetch);
   setSale(fetched);
   setSelection(Object.fromEntries(fetched.lines.map(line=>[line.id,{quantity:'0',condition:'resellable'}])));
  }catch(err){setError(errorText(err));}
  finally{setBusy(false);}
 }
 function select(id:string,update:Partial<Selection>){
  setSelection(current=>({...current,[id]:{...current[id],...update}}));
  setPreview(null);setParts({});
 }
 const items:Item[]=(sale?.lines??[]).flatMap(line=>{
  const entry=selection[line.id];
  const quantity=Number(entry?.quantity??'0');
  return entry&&Number.isSafeInteger(quantity)&&quantity>0&&quantity<=line.available_to_return
   ?[{sale_line_id:line.id,quantity,condition:entry.condition}]:[];
 });
 const invalid=(sale?.lines??[]).some(line=>{
  const quantity=Number(selection[line.id]?.quantity??'0');
  return !Number.isSafeInteger(quantity)||quantity<0||quantity>line.available_to_return;
 });

 async function calculate(){
  if(!sale||!items.length||invalid)return;
  setBusy(true);setError('');
  try{
   const out=await jsonRequest<Preview>('/v1/management/after-sales/refund/preview',{method:'POST',
    headers:{...headers(session),'content-type':'application/json'},
    body:JSON.stringify({sale_number:Number(sale.sale_number),items})},fetch);
   setPreview(out);
   setParts(Object.fromEntries(ORDER.map(method=>[method,{
    amount:centsText(out.suggested.find(p=>p.method===method)?.amount_cents??0),reference:''}])));
  }catch(err){setError(errorText(err));}
  finally{setBusy(false);}
 }

 let chosen:{method:string;amount_cents:number;external_reference?:string}[]=[];
 let partsError='';
 try{
  chosen=ORDER.flatMap(method=>{
   const cents=parseReais(parts[method]?.amount??'');
   if(!cents)return [];
   if(cents>(preview?.refundable[method]??0))throw new Error(`${METHOD_LABELS[method]}: no máximo ${brl(preview?.refundable[method]??0)}`);
   const reference=parts[method]?.reference.trim()??'';
   if(needsReference(method)&&reference.length<4)throw new Error(`${METHOD_LABELS[method]}: informe o comprovante do estorno`);
   return [{method,amount_cents:cents,...(needsReference(method)?{external_reference:reference}:{})}];
  });
 }catch(err){partsError=errorText(err);}
 const chosenTotal=chosen.reduce((n,p)=>n+p.amount_cents,0);
 if(!partsError&&preview&&chosenTotal!==preview.amount_cents)
  partsError=`A soma das formas (${brl(chosenTotal)}) precisa ser igual ao reembolso (${brl(preview.amount_cents)}).`;
 const needsCash=chosen.some(p=>p.method==='cash');

 async function record(event:FormEvent){
  event.preventDefault();
  if(!sale||!preview||busy||!confirmed||partsError||(needsCash&&!cashId))return;
  setError('');setBusy(true);
  try{
   const outcome=await sendOnce<Result>(session,'POST','/v1/management/after-sales/refund',{
    sale_number:Number(sale.sale_number),reason:reason.trim(),items,parts:chosen,
    ...(cashId?{cash_session_id:cashId}:{})},pending);
   setUncertain(false);setResult(outcome);setSale(null);setPreview(null);
   onReturned();
  }catch(err){
   setError(errorText(err));
   setUncertain(pending.current!==null);
  }finally{setBusy(false);}
 }
 const locked=busy||uncertain;
 return <section>
  <h2>Devolução de peças</h2>
  <p className="muted">Localize a venda, marque as peças recebidas e a condição física. O reembolso considera o desconto dado na venda e respeita quanto foi pago em cada forma.</p>
  <form onSubmit={event=>void lookup(event)}>
   <label>Número da venda
    <input inputMode="numeric" pattern="[1-9][0-9]{0,15}" required value={number}
     onChange={event=>setNumber(event.target.value)} disabled={locked}/></label>
   <button type="submit" className="light-button" disabled={locked}>Localizar venda</button>
  </form>
  {sale&&<div className="editor-block">
    <h3>Venda nº {sale.sale_number} · {brl(Number(sale.total_cents))}</h3>
    {!['confirmed','partially_returned'].includes(sale.status)?<p role="status">Esta venda não possui peças disponíveis para devolução.</p>:
    <form onSubmit={event=>void record(event)}>
     <fieldset disabled={locked}>
      <legend>1. Peças e condição</legend>
      {sale.lines.map(line=><div className="editor-block" key={line.id}>
       <strong>{line.product_name} · {line.color} / {line.size}</strong>
       <p className="muted small">SKU {line.sku} · pago {brl(line.line_total_cents)} por {line.quantity} · {line.available_to_return} disponíveis para devolver</p>
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
      <button type="button" className="light-button" disabled={!items.length||invalid}
       onClick={()=>void calculate()}>Calcular reembolso</button>
     </fieldset>
     {preview&&<fieldset disabled={locked}>
      <legend>2. Como devolver {brl(preview.amount_cents)}</legend>
      <p className="muted small">Sugestão do sistema já preenchida. Ajuste se a cliente preferir outra forma, dentro do limite de cada uma.</p>
      {ORDER.filter(method=>(preview.refundable[method]??0)>0).map(method=><div className="fields-two" key={method}>
       <label>{METHOD_LABELS[method]} (até {brl(preview.refundable[method])}){method==='store_credit'?' — abate parcelas em aberto':''}
        <input inputMode="decimal" placeholder="0,00" value={parts[method]?.amount??''}
         onChange={event=>setParts(c=>({...c,[method]:{...c[method],amount:event.target.value}}))}/></label>
       {needsReference(method)&&<label>Comprovante do estorno
        <input maxLength={128} value={parts[method]?.reference??''}
         onChange={event=>setParts(c=>({...c,[method]:{...c[method],reference:event.target.value}}))}/></label>}
      </div>)}
      {partsError&&<p role="alert" className="error">{partsError}</p>}
      <label>Motivo da devolução
       <input required minLength={8} maxLength={250} value={reason}
        onChange={event=>setReason(event.target.value)}/></label>
      <label><input type="checkbox" checked={confirmed}
       onChange={event=>setConfirmed(event.target.checked)}/> Conferi fisicamente as peças e o valor do reembolso</label>
      {needsCash&&!cashId&&<p role="alert">Abra o caixa para devolver em dinheiro.</p>}
     </fieldset>}
     {preview&&<button type="submit" className="primary-action"
      disabled={busy||!confirmed||Boolean(partsError)||reason.trim().length<8||(needsCash&&!cashId)}>
      {uncertain?'Repetir solicitação sem duplicar':'Registrar devolução e reembolso'}
     </button>}
    </form>}
   </div>}
  {result&&<p role="status">Devolução registrada: {brl(result.refunded_cents)} ({result.parts.map(p=>`${METHOD_LABELS[p.method]??p.method} ${brl(p.amount_cents)}`).join(', ')}).
   {result.customer_credit_cents>0?` ${brl(result.customer_credit_cents)} ficou como crédito da cliente.`:''} Situação: {result.status==='returned'?'devolução concluída':'devolução parcial'}.</p>}
  {error&&<p role="alert" className="error">{error}{uncertain?' O resultado pode ter sido gravado; repita sem alterar nada para não duplicar.':''}</p>}
 </section>;
}
