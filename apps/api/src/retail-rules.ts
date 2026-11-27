import {DomainError} from './transactions.ts';
export type CreditInstallment={amount_cents:number;due_on:string};
export function validDate(value:string):boolean{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T00:00:00Z');
 return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function cents(value:number,label:string):void{
 if(!Number.isSafeInteger(value)||value<0||value>999999999999)throw new DomainError(422,'INVALID_AMOUNT',label+' deve ser inteiro e não negativo');
}
export function creditInstallments(total:number,installments:CreditInstallment[]){
 cents(total,'Total');
 if(total<=0||!Array.isArray(installments)||installments.length<1||installments.length>24)
  throw new DomainError(422,'INVALID_INSTALLMENTS','Informe de 1 a 24 parcelas');
 let sum=0,previous='';
 for(const i of installments){
  cents(i.amount_cents,'Parcela');
  if(!i.amount_cents)throw new DomainError(422,'INVALID_INSTALLMENTS','Parcela deve ser positiva');
  if(!validDate(i.due_on)||i.due_on<=previous)throw new DomainError(422,'INVALID_DATE','Data de vencimento inválida ou fora de ordem');
  sum+=i.amount_cents;previous=i.due_on;
 }
 if(sum!==total)throw new DomainError(422,'INSTALLMENT_SUM','A soma das parcelas deve ser igual ao principal');
 return installments.map(x=>({...x}));
}
export function exchangeBalance(returnCents:number,replacementCents:number){
 cents(returnCents,'Devolução');cents(replacementCents,'Troca');
 return {extra_due_cents:Math.max(0,replacementCents-returnCents),
  credit_cents:Math.max(0,returnCents-replacementCents),
  exchange_payment_cents:Math.min(returnCents,replacementCents)};
}
export function commissionCents(amount:number,rateBps:number){
 cents(amount,'Base comissão');
 if(!Number.isSafeInteger(rateBps)||rateBps<0||rateBps>10000)
  throw new DomainError(422,'INVALID_COMMISSION','Taxa de comissão deve estar entre 0 e 100%');
 return Math.floor(amount*rateBps/10000);
}
export function loyaltyPoints(amount:number){cents(amount,'Compra');return Math.floor(amount/100);}
export function settlementAllowed(principal:number,settled:number,payment:number){
 cents(principal,'Principal');cents(settled,'Quitado');cents(payment,'Pagamento');
 if(!payment||settled>principal||payment>principal-settled)
  throw new DomainError(409,'OVER_SETTLEMENT','Pagamento excede saldo aberto');
 return principal-settled-payment;
}
export function dreTotals(input:{gross_cents:number;returns_cents:number;cost_cents:number;
 expenses_cents:number;commissions_cents:number;tax_cents:number;unknown_cost_lines:number}){
 Object.entries(input).forEach(([k,v])=>{
  if(k==='cost_cents'||k==='commissions_cents'){
   if(!Number.isSafeInteger(v)||Math.abs(v)>999999999999)throw new DomainError(422,'INVALID_AMOUNT',k+' fora do limite');
  }else cents(v,k);
 });
 const net_revenue_cents=input.gross_cents-input.returns_cents;
 const gross_profit_cents=net_revenue_cents-input.cost_cents;
 const operating_result_cents=gross_profit_cents-input.expenses_cents-input.commissions_cents-input.tax_cents;
 return {net_revenue_cents,gross_profit_cents,operating_result_cents,
  complete:input.unknown_cost_lines===0,unknown_cost_lines:input.unknown_cost_lines};
}
/**
 * Distribui o desconto da venda entre as linhas. Cada linha recebe seu desconto próprio
 * e uma fatia do desconto geral proporcional ao valor que sobrou, pelo maior resto.
 */
export function allocateDiscounts(lines:ReadonlyArray<{gross_cents:number;discount_cents:number}>,orderDiscount:number){
 cents(orderDiscount,'Desconto');
 const net=lines.map(l=>{
  cents(l.gross_cents,'Linha');cents(l.discount_cents,'Desconto da linha');
  if(l.discount_cents>l.gross_cents)throw new DomainError(422,'DISCOUNT_TOO_HIGH','Desconto maior que o valor da peça');
  return l.gross_cents-l.discount_cents;
 });
 const base=net.reduce((a,b)=>a+b,0);
 if(orderDiscount>base)throw new DomainError(422,'DISCOUNT_TOO_HIGH','Desconto maior que o valor da venda');
 const shares=net.map(n=>base?Math.floor(n*orderDiscount/base):0);
 let rest=orderDiscount-shares.reduce((a,b)=>a+b,0);
 const order=net.map((n,i)=>({i,frac:base?(n*orderDiscount)%base:0})).sort((a,b)=>b.frac-a.frac||a.i-b.i);
 for(const item of order){if(!rest)break;if(shares[item.i]<net[item.i]){shares[item.i]++;rest--;}}
 return lines.map((l,i)=>l.discount_cents+shares[i]);
}
/** Valor líquido a devolver por k unidades de uma linha já parcialmente devolvida. */
export function lineRefundCents(lineTotal:number,quantity:number,alreadyReturned:number,k:number){
 cents(lineTotal,'Linha');
 if(!Number.isSafeInteger(quantity)||quantity<1||alreadyReturned<0||k<1||alreadyReturned+k>quantity)
  throw new DomainError(409,'RETURN_QUANTITY','Quantidade indisponível para devolução');
 return Math.floor(lineTotal*(alreadyReturned+k)/quantity)-Math.floor(lineTotal*alreadyReturned/quantity);
}
