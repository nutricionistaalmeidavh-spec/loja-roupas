import type { Session } from './api-client.ts';
import { headers,jsonRequest,ApiError } from './api-client.ts';
export type CashSession = {id:string;terminal_code:string;opening_cents:number;active:boolean;opened_at:string};
export type CashState = CashSession | {active:false;terminal_code:string};
export type SaleLineInput = {variant_id:string;quantity:number;expected_price_cents:number;expected_price_revision:number};
export type PaymentInput={method:'cash'|'pix_manual'|'card_external'|'store_credit'|'customer_credit';amount_cents:number;confirmed:boolean;external_reference?:string};
export type QuoteLine={variant_id:string;quantity:number;sku:string;product_name:string;price_cents:number;price_revision:number;available:number};
export type SaleQuote={total_cents:number;can_commit:boolean;lines:Array<QuoteLine&{promotion_name?:string|null;promotion_cents?:number}>;subtotal_cents?:number;discount_cents?:number;
 promotion_cents?:number;
 discount_requires_manager?:boolean;cashier_discount_limit_bps?:number};
export type Sale={id:string;sale_number:number;status:string;total_cents:number;tendered_cents:number;
 change_cents:number;created_at:string;cash_session_id:string};
export type SaleDetail=Sale&{lines:Array<{product_name:string;sku:string;color:string;size:string;quantity:number;
 unit_price_cents:number;line_total_cents:number}>;payments:Array<{method:string;amount_cents:number;external_reference:string|null}>};
function write(session:Session,key:string){return {...headers(session,key),'content-type':'application/json'};}
export function currentCash(session:Session,terminal='CAIXA-01',fetchImpl:typeof fetch=fetch){
 return jsonRequest<CashState>('/v1/cash-sessions/current?terminal='+encodeURIComponent(terminal),{
  method:'GET',headers:headers(session)
 },fetchImpl);
}
export function openCash(session:Session,opening_cents:number,terminal_code:string,key:string,fetchImpl:typeof fetch=fetch){
 return jsonRequest<CashSession>('/v1/cash-sessions',{method:'POST',headers:write(session,key),
  body:JSON.stringify({terminal_code,opening_cents})},fetchImpl);
}
export function closeCash(session:Session,id:string,counted_cash_cents:number,reason:string,key:string,fetchImpl:typeof fetch=fetch){
 return jsonRequest<{id:string;active:false;expected_cash_cents:number;counted_cash_cents:number;difference_cents:number}>(
  '/v1/cash-sessions/'+encodeURIComponent(id)+'/close',{method:'POST',headers:write(session,key),
   body:JSON.stringify({counted_cash_cents,...(reason.trim()?{reason:reason.trim()}:{})})},fetchImpl);
}
export function moveCash(session:Session,id:string,kind:'supply'|'withdrawal',amount_cents:number,
 reason:string,key:string,fetchImpl:typeof fetch=fetch){
 return jsonRequest<{id:string;expected_cash_cents:number}>(
 '/v1/cash-sessions/'+encodeURIComponent(id)+'/movements',{method:'POST',headers:write(session,key),
  body:JSON.stringify({kind,amount_cents,reason:reason.trim()})},fetchImpl);
}
export function quoteSale(session:Session,lines:Array<{variant_id:string;quantity:number}>,fetchImpl:typeof fetch=fetch,discount_cents=0,pickup_order_id?:string){
 return jsonRequest<SaleQuote>('/v1/sales/quotes',{method:'POST',
  headers:{...headers(session),'content-type':'application/json'},
  body:JSON.stringify({lines,...(discount_cents>0?{discount_cents}:{}),...(pickup_order_id?{pickup_order_id}:{})})},fetchImpl);
}
export type RetailCheckoutOptions={customer_id?:string;seller_id?:string;discount_cents?:number;discount_reason?:string;
 credit_installments?:Array<{amount_cents:number;due_on:string}>};
export function commitSale(session:Session,cash_session_id:string,lines:SaleLineInput[],
 payments:PaymentInput[],key:string,fetchImpl:typeof fetch=fetch,pickupOrderId?:string,options:RetailCheckoutOptions={}){
 return jsonRequest<Sale>('/v1/sales',{method:'POST',headers:write(session,key),
  body:JSON.stringify({cash_session_id,lines,payments,...(pickupOrderId ? {pickup_order_id:pickupOrderId} : {}),...options})},fetchImpl);
}
export function saleDetail(session:Session,id:string,fetchImpl:typeof fetch=fetch){
 return jsonRequest<SaleDetail>('/v1/sales/'+encodeURIComponent(id),{
  method:'GET',headers:headers(session)
 },fetchImpl);
}
export async function receiptText(session:Session,id:string,fetchImpl:typeof fetch=fetch,cols?:32|42|90,gift=false){
 let res:Response;
 try{res=await fetchImpl('/v1/sales/'+encodeURIComponent(id)+'/receipt'+(cols||gift?'?'+new URLSearchParams({...(cols?{cols:String(cols)}:{}),...(gift?{gift:'true'}:{})}):''),{
  method:'GET',headers:headers(session),cache:'no-store'
 });}catch{throw new ApiError(0,'NETWORK_ERROR','Sem conexão com o sistema da loja');}
 if(!res.ok)throw new ApiError(res.status,'RECEIPT_FAILED','Não foi possível obter o comprovante');
 return res.text();
}

export type SuspendedDraft={id:string;cash_session_id:string;note:string;lines:Array<{variant_id:string;quantity:number}>;created_at:string};
export type ResumedDraft={id:string;cash_session_id:string;lines:Array<{quantity:number;variant:{
 id:string;sku:string;color:string;size:string;priceCents:number;available:number}}>};
export function suspendSale(session:Session,cash_session_id:string,lines:Array<{variant_id:string;quantity:number}>,
 key:string,fetchImpl:typeof fetch=fetch){
 return jsonRequest<{id:string;status:string}>('/v1/sales/drafts',{method:'POST',headers:write(session,key),
  body:JSON.stringify({cash_session_id,lines})},fetchImpl);
}
export function suspendedSales(session:Session,fetchImpl:typeof fetch=fetch){
 return jsonRequest<{items:SuspendedDraft[]}>('/v1/sales/drafts',{method:'GET',headers:headers(session)},fetchImpl);
}
export function resumeSale(session:Session,id:string,key:string,fetchImpl:typeof fetch=fetch){
 return jsonRequest<ResumedDraft>('/v1/sales/drafts/'+encodeURIComponent(id)+'/resume',{
  method:'POST',headers:write(session,key),body:JSON.stringify({})
 },fetchImpl);
}
