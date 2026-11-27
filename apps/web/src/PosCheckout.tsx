import { requestId } from './request-id.ts';
import { useEffect,useMemo,useRef,useState } from 'react';
import type { FormEvent } from 'react';
import type { DraftLine } from '@loja/domain';
import { ApiError,headers,jsonRequest } from './api-client.ts';
import type { Session } from './api-client.ts';
import { reaisToCents } from './catalog-model.ts';
import { markUncertainSale, clearUncertainSale } from './uncertain-sale.ts';
import { commitSale,quoteSale } from './pos-client.ts';
import type { PickupOrder } from './PickupOrders.tsx';
import type { PaymentInput,Sale,SaleQuote } from './pos-client.ts';

const brl=(cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
const editMoney=(cents:number)=>(cents/100).toFixed(2).replace('.',',');
type Tender={key:string;method:PaymentInput['method'];amount:string;confirmed:boolean;reference:string};
type CheckoutCustomer={id:string;name:string;phone:string|null};
type CheckoutOperator={id:string;login:string};
function splitInstallments(amount:number,count:number,first:string){
 const start=new Date(first+'T00:00:00Z');
 if(!Number.isFinite(start.getTime())||start.toISOString().slice(0,10)!==first)throw Error('Primeiro vencimento inválido');
 if(!Number.isInteger(count)||count<1||count>12)throw Error('Quantidade de parcelas inválida');
 const base=Math.floor(amount/count),rem=amount%count;
 return Array.from({length:count},(_,i)=>{
  const y=start.getUTCFullYear(),m=start.getUTCMonth()+i;
  const last=new Date(Date.UTC(y,m+1,0)).getUTCDate();
  const due=new Date(Date.UTC(y,m,Math.min(start.getUTCDate(),last)));
  return {amount_cents:base+(i<rem?1:0),due_on:due.toISOString().slice(0,10)};
 });
}
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
 const [customers,setCustomers]=useState<CheckoutCustomer[]>([]),[operators,setOperators]=useState<CheckoutOperator[]>([]);
 const [customerId,setCustomerId]=useState(''),[sellerId,setSellerId]=useState('');
 const [creditParts,setCreditParts]=useState(1),[creditDue,setCreditDue]=useState(()=>{
  const d=new Date();return new Date(Date.UTC(d.getFullYear(),d.getMonth()+1,Math.min(28,d.getDate()))).toISOString().slice(0,10);
 });
 const [refresh,setRefresh]=useState(0);
 const [discountText,setDiscountText]=useState(''),[discountMode,setDiscountMode]=useState<'reais'|'percent'>('reais');
 const [discount,setDiscount]=useState(0),[discountReason,setDiscountReason]=useState('');
 const [discountError,setDiscountError]=useState('');
 const [customerQuery,setCustomerQuery]=useState('');
 const [busy,setBusy]=useState(false);
 const [pending,setPending]=useState<{key:string;body:string}|null>(null);
 const [uncertain,setUncertain]=useState(false);
 const modalRef=useRef<HTMLElement>(null);
 const closeRef=useRef(onClose);
 const busyRef=useRef(busy);
 const uncertainRef=useRef(uncertain);
 closeRef.current=onClose;
 busyRef.current=busy;
 uncertainRef.current=uncertain;
 useEffect(()=>{
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const modal=modalRef.current;
  modal?.focus();
  function keydown(event:globalThis.KeyboardEvent){
    if(event.key==='Escape'){
      if(!busyRef.current&&!uncertainRef.current)closeRef.current();
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
 },[]);

 useEffect(()=>{
  const ctrl=new AbortController();
  void jsonRequest<{items:Array<CheckoutOperator&{pin_ready:boolean}>}>('/v1/auth/operators',{headers:headers(session),signal:ctrl.signal},fetch)
   .then(s=>{if(!ctrl.signal.aborted)setOperators(s.items);})
   .catch(()=>{if(!ctrl.signal.aborted)setError('Não foi possível listar os vendedores. A venda sem vínculo permanece disponível.');});
  return ()=>ctrl.abort();
 },[session]);
 useEffect(()=>{
  // Busca de cliente por nome, telefone ou e-mail, sem carregar a base inteira.
  const ctrl=new AbortController();
  const term=customerQuery.trim();
  const timer=setTimeout(()=>{
   const query=new URLSearchParams({limit:'20',...(term?{q:term}:{})});
   void jsonRequest<{items:CheckoutCustomer[]}>('/v1/management/customers?'+query,{headers:headers(session),signal:ctrl.signal},fetch)
    .then(c=>{if(!ctrl.signal.aborted)setCustomers(current=>{
     const chosen=current.find(x=>x.id===customerId);
     return chosen&&!c.items.some(x=>x.id===chosen.id)?[chosen,...c.items]:c.items;});})
    .catch(()=>{});
  },term?300:0);
  return ()=>{clearTimeout(timer);ctrl.abort();};
 },[session,customerQuery]);
 useEffect(()=>{
  let cancelled=false;
  setLoading(true);setError('');
  void quoteSale(session,pickup?.lines ?? draft.map(x=>({variant_id:x.variant.id,quantity:x.quantity})),fetch,discount,pickup?.id).then(result=>{
   if(cancelled)return;
   setQuote(result);setTenders([newTender('cash',editMoney(result.total_cents))]);
   setPending(null);setUncertain(false);
  }).catch(err=>{if(!cancelled){setQuote(null);setError(err instanceof Error?err.message:'Não foi possível cotar a venda');}})
   .finally(()=>{if(!cancelled)setLoading(false);});
  return ()=>{cancelled=true;};
 },[session,draft,pickup,refresh,discount]);
 function applyDiscount(){
  setError('');setDiscountError('');
  if(!discountText.trim()){setDiscount(0);return;}
  try{
   const gross=quote?.subtotal_cents??quote?.total_cents??0;
   let cents:number;
   if(discountMode==='percent'){
    const pct=Number(discountText.trim().replace(',','.'));
    if(!Number.isFinite(pct)||pct<0||pct>=100)throw new Error('Percentual de desconto inválido.');
    cents=Math.round(gross*pct/100);
   }else cents=reaisToCents(discountText);
   if(cents>=gross)throw new Error('O desconto precisa ser menor que o total da venda.');
   setDiscount(cents);
  }catch(e){setDiscountError(e instanceof Error?e.message:'Desconto inválido');}
 }
 const tendered=useMemo(()=>{
  try{return tenders.reduce((sum,x)=>sum+reaisToCents(x.amount),0);}
  catch{return 0;}
 },[tenders]);
 const cashTendered=useMemo(()=>{
  try{return tenders.filter(x=>x.method==='cash').reduce((sum,x)=>sum+reaisToCents(x.amount),0);}
  catch{return 0;}
 },[tenders]);
 // Troco só sai do dinheiro: Pix/cartão acima do total não vira troco.
 const change=quote?Math.min(cashTendered,Math.max(0,tendered-quote.total_cents)):0;
 const nonCashOver=quote?tendered-cashTendered>quote.total_cents:false;
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
    if(!amount_cents||!t.confirmed)throw new Error('Confirme a operação e informe o valor de cada forma de pagamento.');
    const external=t.method==='pix_manual'||t.method==='card_external';
    if((t.method==='store_credit'||t.method==='customer_credit')&&!customerId)
     throw new Error('Selecione um cliente para usar crediário ou crédito da loja.');
    if(t.method==='store_credit'&&!session.roles.includes('manager'))
     throw new Error('Crediário requer autorização do gestor.');
    if(external&&t.reference.trim().length<6)
      throw new Error('Informe a referência externa do Pix/cartão antes de concluir.');
    return {method:t.method,amount_cents,confirmed:true,
      ...(external?{external_reference:t.reference.trim()}:{})};
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
  const creditAmount=payments.filter(p=>p.method==='store_credit').reduce((n,p)=>n+p.amount_cents,0);
  let creditInstallments:Array<{amount_cents:number;due_on:string}>|undefined;
  try{if(creditAmount>0)creditInstallments=splitInstallments(creditAmount,creditParts,creditDue);}
  catch(e){setError(e instanceof Error?e.message:'Parcelas inválidas');return;}
  if(discount>0&&discountReason.trim().length<3){setError('Informe o motivo do desconto.');return;}
  const extras={...(customerId?{customer_id:customerId}:{}),...(sellerId?{seller_id:sellerId}:{}),
   ...(discount>0?{discount_cents:discount,discount_reason:discountReason.trim()}:{}),
   ...(creditInstallments?{credit_installments:creditInstallments}:{})};
  const body=JSON.stringify({cashSessionId,lines,payments,pickupOrderId:pickup?.id,...extras});
  if(pending&&pending.body!==body){
   setError('Há uma venda com resultado pendente. Repita exatamente a mesma operação.');return;
  }
  const key=pending?.key??requestId();
  setPending({key,body});
  setBusy(true);
  try{
   const sold=await commitSale(session,cashSessionId,lines,payments,key,fetch,pickup?.id,extras);
   setPending(null);setUncertain(false);clearUncertainSale(cashSessionId);onConfirmed(sold);
  }catch(err){
   setError(err instanceof Error?err.message:'Falha ao confirmar venda');
   if(err instanceof ApiError && err.status>=400 && err.status<500){
    setPending(null);setUncertain(false);
    if(err.status===409&&!err.code.startsWith('ORDER_'))setError('O estoque, preço ou caixa mudou. Revise a cotação antes de tentar novamente.');
   }else{setUncertain(true);markUncertainSale(cashSessionId);}
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
      {(quote.discount_cents??0)>0&&<>
       <div className="total-row"><span>Subtotal</span><span>{brl(quote.subtotal_cents??quote.total_cents)}</span></div>
       <div className="total-row"><span>Desconto</span><span>− {brl(quote.discount_cents??0)}</span></div></>}
      <div className="total-row"><strong>Total</strong><strong>{brl(quote.total_cents)}</strong></div>
      {!quote.can_commit&&<p role="alert" className="error">Estoque insuficiente. Ajuste os itens antes de continuar.</p>}
    </div>
    <fieldset className="editor-block" disabled={busy||uncertain}><legend>Desconto na venda</legend>
      <div className="fields-two">
       <label>Desconto
        <span style={{display:'flex',gap:'0.5rem'}}>
         <input aria-label="Valor do desconto" inputMode="decimal" placeholder={discountMode==='percent'?'10':'20,00'}
          value={discountText} onChange={e=>setDiscountText(e.target.value)}/>
         <select aria-label="Tipo de desconto" value={discountMode} onChange={e=>setDiscountMode(e.target.value as 'reais'|'percent')}>
          <option value="reais">R$</option><option value="percent">%</option></select>
         <button type="button" className="light-button" onClick={applyDiscount}>Aplicar</button>
        </span></label>
       <label>Motivo do desconto
        <input maxLength={160} value={discountReason} placeholder="Ex.: cliente fiel, peça com detalhe" onChange={e=>setDiscountReason(e.target.value)}/></label>
      </div>
      {discountError&&<p role="alert" className="error">{discountError}</p>}
      {quote.discount_requires_manager&&<p role="alert" className="error">Este desconto passa do limite do caixa ({((quote.cashier_discount_limit_bps??0)/100).toLocaleString('pt-BR')}%). Só um gestor pode confirmar.</p>}
      {discount>0&&<button type="button" className="text-btn" onClick={()=>{setDiscount(0);setDiscountText('');setDiscountError('');}}>Remover desconto</button>}
    </fieldset>
    <div className="editor-block"><h3>Cliente e vendedor</h3>
      <div className="fields-two">
       <label>Buscar cliente (nome, telefone ou e-mail)
        <input aria-label="Buscar cliente" value={customerQuery} placeholder="Digite para buscar" onChange={e=>setCustomerQuery(e.target.value)}/></label>
       <label>Cliente para fidelidade ou crediário
        <select aria-label="Cliente da venda" value={customerId} onChange={e=>setCustomerId(e.target.value)}>
         <option value="">Venda sem cliente vinculado</option>
         {customers.map(c=><option key={c.id} value={c.id}>{c.name}{c.phone?' · '+c.phone:''}</option>)}
        </select></label>
       <label>Vendedor responsável
        <select aria-label="Vendedor da venda" value={sellerId} onChange={e=>setSellerId(e.target.value)}>
         <option value="">Operador do caixa</option>{operators.map(o=><option key={o.id} value={o.id}>{o.login}</option>)}
        </select></label>
      </div>
      <p className="muted small">Crediário exige cliente e limite previamente autorizado. Crédito da loja será descontado somente após confirmação da venda.</p>
    </div>
    <div className="editor-block"><h3>Pagamentos e crédito</h3>
      <p className="muted small">Pix e cartão são lançamentos manuais. Não existe confirmação automática de banco, adquirente ou TEF.</p>
      {tenders.map((t,i)=><fieldset className="tender-row" key={t.key} disabled={busy||uncertain}>
        <legend>Pagamento {i+1}</legend>
        <div className="fields-two"><label>Forma de pagamento
         <select aria-label={'Método pagamento '+(i+1)} value={t.method}
          onChange={e=>update(t.key,{method:e.target.value as Tender['method'],confirmed:false,reference:''})}>
           <option value="cash">Dinheiro</option><option value="pix_manual">Pix conferido manualmente</option>
           <option value="card_external">Cartão em maquininha externa</option>
           {session.roles.includes('manager')&&<option value="store_credit">Crediário (valor a receber)</option>}
           <option value="customer_credit">Saldo de crédito do cliente</option>
         </select></label>
         <label>{t.method==='store_credit'?'Valor financiado (R$)':t.method==='customer_credit'?'Crédito resgatado (R$)':'Valor recebido (R$)'}<input aria-label={'Valor pagamento '+(i+1)} required inputMode="decimal"
          value={t.amount} onChange={e=>update(t.key,{amount:e.target.value})}/></label></div>
        {(t.method==='pix_manual'||t.method==='card_external')&&<label>Referência/comprovante externo
         <input required minLength={6} maxLength={128} aria-label={'Referência pagamento '+(i+1)}
          value={t.reference} placeholder="ID da transação confirmada" onChange={e=>update(t.key,{reference:e.target.value})}/>
        </label>}
        <label className="confirm-tender"><input type="checkbox" checked={t.confirmed}
         onChange={e=>update(t.key,{confirmed:e.target.checked})}/>
         {t.method==='cash'?'Dinheiro recebido e conferido':
          t.method==='store_credit'?'Gestor autorizou venda a prazo; não houve entrada financeira':
          t.method==='customer_credit'?'Cliente autorizou usar saldo de crédito da loja':
          'Pagamento confirmado fora deste sistema e conferido'}
        </label>
        {tenders.length>1&&<button type="button" className="text-btn" onClick={()=>setTenders(x=>x.filter(r=>r.key!==t.key))}>Remover pagamento</button>}
      </fieldset>)}
      {tenders.some(t=>t.method==='store_credit')&&<fieldset className="tender-row">
       <legend>Parcelamento próprio da loja</legend>
       <label>Número de parcelas <select value={creditParts} onChange={e=>setCreditParts(Number(e.target.value))}>
        {[1,2,3,4,5,6,8,10,12].map(n=><option value={n} key={n}>{n} parcela{n>1?'s':''}</option>)}
       </select></label>
       <label>Primeiro vencimento <input type="date" value={creditDue} onChange={e=>setCreditDue(e.target.value)} required/></label>
       <p>As parcelas constituem contas a receber; não entram no saldo do caixa antes da liquidação.</p>
      </fieldset>}
      <button type="button" className="light-button" disabled={busy||uncertain||tenders.length>=6}
       onClick={()=>setTenders(x=>[...x,newTender('pix_manual')])}>+ Adicionar pagamento</button>
    </div>
    <div className="checkout-totals">
      <div className="total-row"><span>Total da venda</span><strong>{brl(quote.total_cents)}</strong></div>
      <div className="total-row"><span>Informado</span><strong>{brl(tendered)}</strong></div>
      <div className="total-row"><span>Restante</span><strong>{brl(due)}</strong></div>
      <div className="total-row"><span>Troco (somente em dinheiro)</span><strong>{brl(change)}</strong></div>
      {nonCashOver&&<p className="error small" role="status">Pix e cartão não geram troco: o valor informado passa do total da venda.</p>}
    </div>
    {error&&<p role="alert" className="error">{error}{uncertain&&' A operação pode ter sido gravada. Não crie outra venda; repita usando a mesma chave.'}</p>}
    <div className="checkout-buttons">
      <button type="button" className="light-button" disabled={busy||uncertain}
        onClick={()=>setRefresh(r=>r+1)}>Atualizar cotação</button>
      <button type="submit" className="primary-action" disabled={!quote.can_commit||busy}>
        {busy?'Confirmando…':uncertain?'Repetir confirmação sem duplicar':
         tenders.some(t=>t.method==='store_credit')?'Confirmar venda e gerar parcelas':'Confirmar venda e pagamentos'}
      </button>
    </div>
   </form>}
   {error&&!quote&&<><p role="alert" className="error">{error}</p><button className="light-button" onClick={()=>setRefresh(r=>r+1)}>Tentar nova cotação</button></>}
  </section>
 </div>;
}
