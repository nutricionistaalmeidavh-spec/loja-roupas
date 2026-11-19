import { requestId } from './request-id.ts';
import { useEffect,useMemo,useRef,useState } from 'react';
import type { FormEvent } from 'react';
import type { DraftLine } from '@loja/domain';
import { ApiError } from './api-client.ts';
import type { Session } from './api-client.ts';
import { reaisToCents } from './catalog-model.ts';
import { commitSale,quoteSale } from './pos-client.ts';
import type { PickupOrder } from './PickupOrders.tsx';
import type { PaymentInput,Sale,SaleQuote } from './pos-client.ts';

const brl=(cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
const editMoney=(cents:number)=>(cents/100).toFixed(2).replace('.',',');
type Tender={key:string;method:'cash'|'pix_manual'|'card_external';amount:string;confirmed:boolean;reference:string};
function newTender(method:Tender['method']='cash',amount=''):Tender {
 return {key:requestId(),method,amount,confirmed:false,reference:''};
}
export function CheckoutDrawer({session,cashSessionId,draft,pickup,onClose,onConfirmed}:{
 session:Session;cashSessionId:string;draft:readonly DraftLine[];pickup?:PickupOrder;onClose:()=>void;onConfirmed:(sale:Sale)=>void
}){
 const [quote,setQuote]=useState<SaleQuote|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [tenders,setTenders]=useState<Tender[]>([newTender()]);
 const [refresh,setRefresh]=useState(0);
 const [busy,setBusy]=useState(false);
 const [pending,setPending]=useState<{key:string;body:string}|null>(null);
 const [uncertain,setUncertain]=useState(false);
 const modalRef=useRef<HTMLElement>(null);
 useEffect(()=>{
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const modal=modalRef.current;
  modal?.focus();
  function keydown(event:globalThis.KeyboardEvent){
    if(event.key==='Escape'){
      if(!busy&&!uncertain)onClose();
      return;
    }
    if(event.key!=='Tab'||!modal)return;
    const focusables=[...modal.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])')].filter(x=>x.getClientRects().length>0);
    if(!focusables.length){event.preventDefault();modal.focus();return;}
    const first=focusables[0],last=focusables[focusables.length-1];
    if(event.shiftKey&&(document.activeElement===first||document.activeElement===modal)){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
  document.addEventListener('keydown',keydown);
  return ()=>{document.removeEventListener('keydown',keydown);previous?.focus();};
 },[busy,uncertain,onClose]);

 useEffect(()=>{
  let cancelled=false;
  setLoading(true);setError('');
  void quoteSale(session,pickup?.lines ?? draft.map(x=>({variant_id:x.variant.id,quantity:x.quantity}))).then(result=>{
   if(cancelled)return;
   setQuote(result);setTenders([newTender('cash',editMoney(result.total_cents))]);
   setPending(null);setUncertain(false);
  }).catch(err=>{if(!cancelled){setQuote(null);setError(err instanceof Error?err.message:'Não foi possível cotar a venda');}})
   .finally(()=>{if(!cancelled)setLoading(false);});
  return ()=>{cancelled=true;};
 },[session,draft,pickup,refresh]);
 const tendered=useMemo(()=>{
  try{return tenders.reduce((sum,x)=>sum+reaisToCents(x.amount),0);}
  catch{return 0;}
 },[tenders]);
 const change=quote?Math.max(0,tendered-quote.total_cents):0;
 const due=quote?Math.max(0,quote.total_cents-tendered):0;
 function update(key:string,changes:Partial<Tender>){
  setTenders(all=>all.map(x=>x.key===key?{...x,...changes}:x));
 }
 async function submit(event:FormEvent){
  event.preventDefault();if(busy||!quote||!quote.can_commit)return;
  setError('');
  let payments:PaymentInput[];
  try {
   payments=tenders.map(t=>{
    const amount_cents=reaisToCents(t.amount);
    if(!amount_cents||!t.confirmed)throw new Error('Confirme o recebimento e informe o valor de cada pagamento.');
    if(t.method!=='cash'&&t.reference.trim().length<6)
      throw new Error('Informe a referência externa do Pix/cartão antes de concluir.');
    return {method:t.method,amount_cents,confirmed:true,
      ...(t.method!=='cash'?{external_reference:t.reference.trim()}:{})};
   });
   const cash=payments.filter(p=>p.method==='cash').reduce((a,b)=>a+b.amount_cents,0);
   const other=payments.filter(p=>p.method!=='cash').reduce((a,b)=>a+b.amount_cents,0);
   if(payments.filter(p=>p.method==='cash').length>1||other>quote.total_cents||tendered<quote.total_cents||
     change>cash)throw new Error('Pagamentos não cobrem a venda ou troco excede dinheiro.');
  }catch(err){setError(err instanceof Error?err.message:'Pagamento inválido');return;}
  const lines=quote.lines.map(line=>({
   variant_id:line.variant_id,quantity:line.quantity,
   expected_price_cents:line.price_cents,expected_price_revision:line.price_revision
  }));
  const body=JSON.stringify({cashSessionId,lines,payments,pickupOrderId:pickup?.id});
  if(pending&&pending.body!==body){
   setError('Há uma venda com resultado pendente. Repita exatamente a mesma operação.');return;
  }
  const key=pending?.key??requestId();
  setPending({key,body});
  setBusy(true);
  try{
   const sold=await commitSale(session,cashSessionId,lines,payments,key,fetch,pickup?.id);
   setPending(null);setUncertain(false);onConfirmed(sold);
  }catch(err){
   setError(err instanceof Error?err.message:'Falha ao confirmar venda');
   if(err instanceof ApiError && err.status>=400 && err.status<500){
    setPending(null);setUncertain(false);
    if(err.status===409&&!err.code.startsWith('ORDER_'))setError('O estoque, preço ou caixa mudou. Revise a cotação antes de tentar novamente.');
   }else setUncertain(true);
  }finally{setBusy(false);}
 }
 return <div className="drawer-backdrop checkout-overlay" onMouseDown={()=>{if(!busy&&!uncertain)onClose();}}>
  <section ref={modalRef} tabIndex={-1} className="checkout-modal" role="dialog" aria-modal="true" aria-label="Revisar e finalizar venda"
    onMouseDown={e=>e.stopPropagation()}>
   <header className="checkout-header"><h2>Revisar e finalizar venda</h2>
    <button type="button" className="light-button" disabled={busy||uncertain} onClick={onClose}>Fechar</button></header>
   {pickup&&<p className="notice">Pedido para retirada · Cotação na vitrine {brl(Number(pickup.quoted_total_cents))}</p>}
   {loading&&<p role="status">Verificando preços e saldos com PostgreSQL…</p>}
   {quote&&!loading&&<form className="checkout-form" onSubmit={event=>void submit(event)}>
    <div className="editor-block"><h3>Itens confirmados na cotação</h3>
      {quote.lines.map(l=><div className="total-row" key={l.variant_id}>
        <span>{l.quantity} × {l.product_name} · {l.sku}</span><strong>{brl(l.price_cents*l.quantity)}</strong>
      </div>)}
      <div className="total-row"><strong>Total</strong><strong>{brl(quote.total_cents)}</strong></div>
      {!quote.can_commit&&<p role="alert" className="error">Estoque insuficiente. Ajuste os itens antes de continuar.</p>}
    </div>
    <div className="editor-block"><h3>Pagamentos recebidos</h3>
      <p className="muted small">Pix e cartão são lançamentos manuais. Não existe confirmação automática de banco, adquirente ou TEF.</p>
      {tenders.map((t,i)=><fieldset className="tender-row" key={t.key} disabled={busy||uncertain}>
        <legend>Pagamento {i+1}</legend>
        <div className="fields-two"><label>Forma de pagamento
         <select aria-label={'Método pagamento '+(i+1)} value={t.method}
          onChange={e=>update(t.key,{method:e.target.value as Tender['method'],confirmed:false,reference:''})}>
           <option value="cash">Dinheiro</option><option value="pix_manual">Pix conferido manualmente</option>
           <option value="card_external">Cartão em maquininha externa</option>
         </select></label>
         <label>Valor recebido (R$)<input aria-label={'Valor pagamento '+(i+1)} required inputMode="decimal"
          value={t.amount} onChange={e=>update(t.key,{amount:e.target.value})}/></label></div>
        {t.method!=='cash'&&<label>Referência/comprovante externo
         <input required minLength={6} maxLength={128} aria-label={'Referência pagamento '+(i+1)}
          value={t.reference} placeholder="ID da transação confirmada" onChange={e=>update(t.key,{reference:e.target.value})}/>
        </label>}
        <label className="confirm-tender"><input type="checkbox" checked={t.confirmed}
         onChange={e=>update(t.key,{confirmed:e.target.checked})}/>
         {t.method==='cash'?'Dinheiro recebido e conferido':'Pagamento confirmado fora deste sistema e conferido'}
        </label>
        {tenders.length>1&&<button type="button" className="text-btn" onClick={()=>setTenders(x=>x.filter(r=>r.key!==t.key))}>Remover pagamento</button>}
      </fieldset>)}
      <button type="button" className="light-button" disabled={busy||uncertain||tenders.length>=6}
       onClick={()=>setTenders(x=>[...x,newTender('pix_manual')])}>+ Adicionar pagamento</button>
    </div>
    <div className="checkout-totals">
      <div className="total-row"><span>Total da venda</span><strong>{brl(quote.total_cents)}</strong></div>
      <div className="total-row"><span>Informado</span><strong>{brl(tendered)}</strong></div>
      <div className="total-row"><span>Restante</span><strong>{brl(due)}</strong></div>
      <div className="total-row"><span>Troco (somente em dinheiro)</span><strong>{brl(change)}</strong></div>
    </div>
    {error&&<p role="alert" className="error">{error}{uncertain&&' A operação pode ter sido gravada. Não crie outra venda; repita usando a mesma chave.'}</p>}
    <div className="checkout-buttons">
      <button type="button" className="light-button" disabled={busy||uncertain}
        onClick={()=>setRefresh(r=>r+1)}>Atualizar cotação</button>
      <button type="submit" className="primary-action" disabled={!quote.can_commit||busy}>
        {busy?'Confirmando…':uncertain?'Repetir confirmação sem duplicar':'Confirmar venda e pagamentos'}
      </button>
    </div>
   </form>}
   {error&&!quote&&<><p role="alert" className="error">{error}</p><button className="light-button" onClick={()=>setRefresh(r=>r+1)}>Tentar nova cotação</button></>}
  </section>
 </div>;
}
