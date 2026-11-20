import {createHash} from 'node:crypto';

export type Listing = {
 id:string;product_id:string;name:string;category:string;color:string;size:string;
 price_cents:number;available:number;published:boolean;photo_url:string|null;
};
export type RemoteOrder = {
 id:string;request_id:string;customer_name:string;customer_phone:string;status:'pending'|'accepted';
 created_at:string;lines:Array<{variant_id:string;quantity:number}>;
};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const safeToken=/^[a-f0-9]{64}$/;
const safeSlug=/^[a-z0-9](?:[a-z0-9-]{1,46})[a-z0-9]$/;
export function isMarketplaceSlug(value:string):boolean{return safeSlug.test(value);}
export function isMarketplaceKey(value:string):boolean{return safeToken.test(value);}
export function marketplaceBaseUrl(env:Record<string,string|undefined>=process.env):URL{
 const url=new URL(env.LOJA_MARKETPLACE_URL||'https://loja-roupas-vitrine.sistema-artisys.workers.dev');
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')
  throw new Error('LOJA_MARKETPLACE_URL deve ser um origin HTTPS sem caminho e credenciais');
 return url;
}
export function listingFingerprint(item:Listing):string{
 return createHash('sha256').update(JSON.stringify(item)).digest('hex');
}
export function nextListingRevision(previous:number,clock=Date.now()):number{
 return Math.max(previous+1,clock);
}
export function normalizeCloudStatus(raw:unknown):'pending'|'accepted'{
 if(raw!=='pending'&&raw!=='accepted')throw new Error('Status remoto incompatível');
 return raw;
}
export function normalizeRemoteOrder(raw:unknown):RemoteOrder{
 if(typeof raw!=='object'||raw===null)throw new Error('Pedido remoto inválido');
 const o=raw as Record<string,unknown>;
 if(typeof o.id!=='string'||!uuid.test(o.id)||typeof o.request_id!=='string'||o.request_id.length<8||o.request_id.length>90||
    typeof o.customer_name!=='string'||o.customer_name.trim().length<2||o.customer_name.length>120||
    typeof o.customer_phone!=='string'||o.customer_phone.length>32||
    typeof o.created_at!=='string'||!Number.isFinite(Date.parse(o.created_at))||
    !Array.isArray(o.lines)||o.lines.length<1||o.lines.length>12)
   throw new Error('Pedido remoto inválido');
 const ids=new Set<string>();
 const lines=o.lines.map((rawLine:unknown)=>{
  if(typeof rawLine!=='object'||!rawLine)throw new Error('Linha inválida');
  const line=rawLine as Record<string,unknown>;
  if(typeof line.variant_id!=='string'||!uuid.test(line.variant_id)||
    !Number.isSafeInteger(line.quantity)||Number(line.quantity)<1||Number(line.quantity)>10||
    ids.has(line.variant_id))throw new Error('Linha remota inválida');
  ids.add(line.variant_id);
  return {variant_id:line.variant_id,quantity:line.quantity as number};
 });
 return {id:o.id,request_id:o.request_id,customer_name:o.customer_name.trim(),
   customer_phone:o.customer_phone,status:normalizeCloudStatus(o.status),created_at:o.created_at,lines};
}
