import {ApiError,headers,jsonRequest} from './api-client.ts';
import type {Session} from './api-client.ts';
import {requestId} from './request-id.ts';

export type Pending={body:string;key:string}|null;
/**
 * Envia uma escrita com chave de repetição. Se a resposta se perder, repetir com o mesmo conteúdo
 * reaproveita a chave e o servidor não duplica a operação.
 */
export async function sendOnce<T>(session:Session,method:'POST'|'PUT',url:string,payload:unknown,
 pending:{current:Pending}):Promise<T>{
 const body=JSON.stringify(payload);
 const key=pending.current?.body===body?pending.current.key:requestId();
 pending.current={body,key};
 try{
  const out=await jsonRequest<T>(url,{method,headers:{...headers(session,key),'content-type':'application/json'},body},fetch);
  pending.current=null;
  return out;
 }catch(error){
  if(error instanceof ApiError&&error.status>=400&&error.status<500)pending.current=null;
  throw error;
 }
}
export const brl=(cents:number|string)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(cents)/100);
export const errorText=(error:unknown)=>error instanceof Error?error.message:'Falha na operação';
export const METHOD_LABELS:Record<string,string>={cash:'Dinheiro',pix_manual:'Pix',card_external:'Cartão',
 store_credit:'Crediário',customer_credit:'Crédito do cliente',exchange_credit:'Crédito de troca'};
/** "149,90" → 14990. Aceita vazio como 0. */
export function parseReais(value:string):number{
 const clean=value.trim().replace(/\./g,'').replace(',','.');
 if(!clean)return 0;
 if(!/^\d+(?:\.\d{1,2})?$/.test(clean))throw new Error('Valor inválido: use o formato 149,90');
 return Math.round(Number(clean)*100);
}
