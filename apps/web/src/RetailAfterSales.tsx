import {useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {ApiError,headers,jsonRequest,scanCatalog} from './api-client.ts';
import type {Session} from './api-client.ts';
import {mapCatalog} from './catalog-model.ts';
import {requestId} from './request-id.ts';
type Line={id:string;sku:string;product_name:string;color:string;size:string;available_to_return:number;unit_price_cents:number};
type Sale={id:string;sale_number:string;status:string;cash_only:boolean;lines:Line[]};
const brl=(value:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value/100);
export function RetailAfterSales({session,onUpdated,cashId}:{session:Session;onUpdated:()=>void;cashId:string|null}){
 const [number,setNumber]=useState(''),[sale,setSale]=useState<Sale|null>(null),[lineId,setLineId]=useState(''),
 [qty,setQty]=useState(1),[mode,setMode]=useState<'refund'|'exchange'>('refund'),
 [condition,setCondition]=useState<'resellable'|'quarantine'>('resellable'),
 [method,setMethod]=useState<'pix_manual'|'card_external'>('pix_manual'),
 [ref,setRef]=useState(''),[confirmed,setConfirmed]=useState(false),
 [replacement,setReplacement]=useState(''),[replacementQty,setReplacementQty]=useState(1),
 [replacementInfo,setReplacementInfo]=useState<{id:string;sku:string;priceCents:number}|null>(null),
 [paidBy,setPaidBy]=useState<'cash'|'pix_manual'|'card_external'>('cash'),[paymentRef,setPaymentRef]=useState(''),
 [customerId,setCustomerId]=useState(''),[reason,setReason]=useState(''),
 [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const pending=useRef<{signature:string;key:string}|null>(null);
 const selected=sale?.lines.find(l=>l.id===lineId),oldValue=Number(selected?.unit_price_cents||0)*qty,
 replacementValue=Number(replacementInfo?.priceCents||0)*replacementQty,
 extra=Math.max(0,replacementValue-oldValue),credit=Math.max(0,oldValue-replacementValue);
 async function findSale(event:FormEvent){
  event.preventDefault();setBusy(true);setError('');setSale(null);setLineId('');
  try{
   if(!/^[1-9]\d{0,15}$/.test(number))throw Error('Número de venda inválido.');
   const found=await jsonRequest<Sale>('/v1/management/sales/by-number/'+number,
    {headers:headers(session)},fetch);
   setSale(found);setLineId(found.lines.find(x=>x.available_to_return>0)?.id||'');
  }catch(e){setError(e instanceof Error?e.message:'Venda não encontrada');}
  finally{setBusy(false);}
 }
 async function lookupReplacement(event:FormEvent){
  event.preventDefault();setBusy(true);setError('');setReplacementInfo(null);
  try{
   const result=mapCatalog(await scanCatalog(session,replacement.trim()));
   const matches=result.flatMap(p=>p.variants).filter(v=>
    v.sku.toUpperCase()===replacement.trim().toUpperCase()||
    (v.barcode||'').toUpperCase()===replacement.trim().toUpperCase());
   if(matches.length!==1)throw Error('Informe um SKU ou código de barras único de reposição.');
   setReplacementInfo({id:matches[0].id,sku:matches[0].sku,priceCents:matches[0].priceCents});
  }catch(e){setError(e instanceof Error?e.message:'Peça não encontrada');}
  finally{setBusy(false);}
 }
 async function execute(event:FormEvent){
  event.preventDefault();
  if(!sale||!selected||busy)return;
  if(qty<1||qty>selected.available_to_return){setError('Quantidade indisponível para devolução');return;}
  if(reason.trim().length<8){setError('Justifique a operação em pelo menos 8 caracteres');return;}
  const base={sale_number:Number(number),sale_line_id:selected.id,quantity:qty,condition,reason:reason.trim()};
  const path=mode==='refund'?'/v1/management/after-sales/external-refund':'/v1/management/after-sales/exchange';
  if(mode==='exchange'&&!cashId){setError('Abra o caixa para efetuar trocas');return;}
  if(mode==='exchange'&&!replacementInfo){setError('Localize a peça de substituição');return;}
  if(mode==='exchange'&&credit>0&&!customerId.trim()){setError('Informe o ID do cliente para emissão de crédito');return;}
  const body=mode==='refund'
   ?{...base,method,external_reference:ref.trim(),confirmed}
   :{...base,replacement_variant_id:replacementInfo!.id,replacement_quantity:replacementQty,cash_session_id:cashId,
    ...(customerId.trim()?{customer_id:customerId.trim()}:{}),
    ...(extra>0?{payment:{method:paidBy,confirmed:true,...(paidBy==='cash'?{}:{external_reference:paymentRef.trim()})}}:{})};
  const payload=JSON.stringify(body);
  const key=pending.current?.signature===payload?pending.current.key:requestId();
  pending.current={signature:payload,key};
  if(!window.confirm(mode==='refund'?
   'Confirma que o estorno já foi realizado no banco/maquininha? O sistema não transfere dinheiro.':
   'Confirmar troca de peças, ajuste de estoque e eventual diferença financeira?'))return;
  setBusy(true);setError('');setNotice('');
  try{
   const result=await jsonRequest<{id:string;refunded_cents?:number;credit_cents?:number;replacement_sale_number?:number}>(
    path,{method:'POST',headers:{...headers(session,key),'content-type':'application/json'},body:payload},fetch);
   pending.current=null;setNotice(mode==='refund'?'Estorno registrado: '+brl(result.refunded_cents||0):
    'Troca registrada, venda nova nº '+result.replacement_sale_number+', crédito: '+brl(result.credit_cents||0));
   setSale(null);setLineId('');setConfirmed(false);onUpdated();
  }catch(e){
   if(e instanceof ApiError&&e.status>=400&&e.status<500)pending.current=null;
   setError(e instanceof Error?e.message:'Falha de operação; verifique histórico antes de repetir');
  }finally{setBusy(false);}
 }
 return <section aria-label="Trocas e estornos externos" className="management-section">
  <h3>Trocar peças ou registrar estorno Pix/cartão</h3>
  <p>A operação atualiza estoque e auditoria na mesma transação. Estornos externos exigem confirmação humana; não são enviados automaticamente ao banco.</p>
  {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <form className="management-form" onSubmit={e=>void findSale(e)}>
   <label>Número da venda <input value={number} onChange={e=>setNumber(e.target.value)}
    inputMode="numeric" required placeholder="Ex.: 123"/></label>
   <button disabled={busy}>Consultar venda</button>
  </form>
  {sale&&<form className="management-form" onSubmit={e=>void execute(e)}>
   <label>Modalidade <select value={mode} onChange={e=>setMode(e.target.value as 'refund'|'exchange')}>
    <option value="refund">Registrar estorno Pix ou cartão</option>
    <option value="exchange">Troca por outra peça</option></select></label>
   <label>Peça devolvida <select required value={lineId} onChange={e=>setLineId(e.target.value)}>
    {sale.lines.filter(l=>l.available_to_return>0).map(l=>
     <option key={l.id} value={l.id}>{l.product_name} · {l.sku} · {l.color}/{l.size} · até {l.available_to_return}</option>)}
   </select></label>
   <label>Quantidade devolvida <input type="number" min={1} max={selected?.available_to_return||1}
    required value={qty} onChange={e=>setQty(Number(e.target.value))}/></label>
   <label>Destino da peça <select value={condition} onChange={e=>setCondition(e.target.value as 'resellable'|'quarantine')}>
    <option value="resellable">Revenda após conferência</option><option value="quarantine">Quarentena / avaria</option>
   </select></label>
   {selected&&<p>Valor original proporcional: <strong>{brl(oldValue)}</strong></p>}
   {mode==='refund'?<>
    <label>Meio do pagamento original <select value={method} onChange={e=>setMethod(e.target.value as 'pix_manual'|'card_external')}>
     <option value="pix_manual">Pix</option><option value="card_external">Cartão</option></select></label>
    <label>ID do estorno externo confirmado <input value={ref} onChange={e=>setRef(e.target.value)}
     required minLength={6} maxLength={128}/></label>
    <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
     Estorno confirmado no banco ou na maquininha fora do sistema</label>
   </>:<>
    <form className="management-form" onSubmit={e=>void lookupReplacement(e)}>
     <label>SKU/código da peça nova <input value={replacement} onChange={e=>{setReplacement(e.target.value);setReplacementInfo(null);}} required/></label>
     <button disabled={busy}>Buscar reposição</button>
    </form>
    {replacementInfo&&<>
     <p>Peça nova: <strong>{replacementInfo.sku} · {brl(replacementInfo.priceCents)}</strong></p>
     <label>Quantidade nova <input type="number" min={1} max={10000}
      value={replacementQty} onChange={e=>setReplacementQty(Number(e.target.value))}/></label>
     <p>Diferença a cobrar: {brl(extra)}. Crédito ao cliente: {brl(credit)}.</p>
     {extra>0&&<>
      <label>Como recebeu diferença <select value={paidBy} onChange={e=>setPaidBy(e.target.value as typeof paidBy)}>
       <option value="cash">Dinheiro</option><option value="pix_manual">Pix conferido</option>
       <option value="card_external">Cartão externo</option></select></label>
      {paidBy!=='cash'&&<label>Comprovante do pagamento <input value={paymentRef}
       onChange={e=>setPaymentRef(e.target.value)} required minLength={6}/></label>}
     </>}
    </>}
    <label>Cliente (UUID, obrigatório se gerar crédito) <input value={customerId}
     onChange={e=>setCustomerId(e.target.value)} placeholder="ID do cliente"/></label>
    {!cashId&&<p role="alert">Abra um caixa para confirmar a troca.</p>}
   </>}
   <label>Motivo e conferência <textarea value={reason} onChange={e=>setReason(e.target.value)}
    minLength={8} maxLength={250} required/></label>
   <button className="primary-action" disabled={busy||!selected||mode==='refund'&&!confirmed||
    mode==='exchange'&&(!cashId||!replacementInfo)}>Confirmar operação</button>
  </form>}
 </section>;
}
