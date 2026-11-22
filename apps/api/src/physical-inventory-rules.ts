import {DomainError} from './transactions.ts';
export function reconcileCount(input:{expected:number;current:number;counted:number;reserved:number}){
 const {expected,current,counted,reserved}=input;
 if(Object.values(input).some(x=>!Number.isSafeInteger(x)||x<0))
  throw new DomainError(422,'INVALID_COUNT','Quantidades do inventário devem ser inteiras não negativas.');
 if(expected!==current)throw new DomainError(409,'COUNT_STALE','Saldo alterado desde a contagem. Reconte antes de concluir.');
 if(counted<reserved)throw new DomainError(409,'COUNT_RESERVED','Contagem inferior às unidades reservadas.');
 return counted-current;
}
