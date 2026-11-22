import {DomainError} from './transactions.ts';
export type ExpenseInput={amount_cents:number;category:string;description:string;occurred_on:string};
export function validateOperatingExpense(v:ExpenseInput):ExpenseInput{
 if(!Number.isSafeInteger(v.amount_cents)||v.amount_cents<1||v.amount_cents>9999999999)
  throw new DomainError(422,'INVALID_EXPENSE','Valor da despesa deve ser positivo e em centavos.');
 const category=String(v.category||'').trim(),description=String(v.description||'').trim();
 if(!category||category.length>80||!description||description.length>240)
  throw new DomainError(422,'INVALID_EXPENSE','Informe categoria e descrição de até 80/240 caracteres.');
 const occurred_on=String(v.occurred_on||'');
 if(!/^\d{4}-\d\d-\d\d$/.test(occurred_on))throw new DomainError(422,'INVALID_DATE','Data inválida.');
 const date=new Date(occurred_on+'T00:00:00Z');
 if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==occurred_on)
  throw new DomainError(422,'INVALID_DATE','Data inválida.');
 return {amount_cents:v.amount_cents,category,description,occurred_on};
}
export function calculateOperatingResult(input:{gross_cents:number;refunds_cents:number;expenses_cents:number}){
 const {gross_cents,refunds_cents,expenses_cents}=input;
 for(const amount of Object.values(input))
  if(!Number.isSafeInteger(amount)||amount<0)throw new Error('Total monetário inválido');
 const net_sales_cents=gross_cents-refunds_cents;
 const operational_balance_cents=net_sales_cents-expenses_cents;
 if(!Number.isSafeInteger(net_sales_cents)||!Number.isSafeInteger(operational_balance_cents))
  throw new Error('Total monetário fora do intervalo');
 return {gross_cents,refunds_cents,expenses_cents,net_sales_cents,operational_balance_cents};
}
