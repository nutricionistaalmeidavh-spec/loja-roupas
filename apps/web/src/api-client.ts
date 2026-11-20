import type { CatalogPage } from './catalog-model.ts';

export type StoreAccess = { store_id: string; roles: string[] };
export type LoginResult = { token: string; expires_at: string; stores: StoreAccess[] };
export type Session = { token: string; storeId: string; roles: string[] };
export type ProductPatchPayload = {name:string;category:string;expected_revision:number};
export type VariantPricePayload = {price_cents:number;expected_revision:number};
export type StockAdjustPayload = {variant_id:string;reference_id:string;counted_on_hand:number;expected_revision:number;reason:string};
export type StockMovement = {id:string;movement_kind:string;qty_delta:number;occurred_at:string;source_type:string};
export type ProductPayload = {
  name: string; category: string;
  variants: Array<{sku:string;color:string;size:string;price_cents:number;barcode?:string|null}>;
};
export type StockReceiptPayload = { variant_id: string; reference_id: string; quantity: number; note?: string };
export type StockReceiptResult = { movement_id: string; variant_id: string; on_hand: number; reserved: number; revision: number };
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export async function jsonRequest<T>(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<T> {
  let response: Response;
  try { response = await fetchImpl(url, { ...init, cache: 'no-store' }); }
  catch { throw new ApiError(0, 'NETWORK_ERROR', 'Não foi possível conectar ao servidor LAN.'); }
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new ApiError(response.status, 'INVALID_RESPONSE', 'Resposta inválida do servidor.'); }
  if (!response.ok) {
    const error = body && typeof body === 'object' ? body as {code?:string;message?:string} : {};
    throw new ApiError(response.status, error.code ?? 'API_ERROR',
      error.message ?? 'Falha de comunicação com o servidor.');
  }
  return body as T;
}
export function headers(session: Session, idempotencyKey?: string): Record<string,string> {
  return {
    authorization: 'Bearer ' + session.token,
    'x-store-id': session.storeId,
    ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
  };
}
export function login(loginName: string, password: string, fetchImpl: typeof fetch = fetch): Promise<LoginResult> {
  return jsonRequest<LoginResult>('/v1/auth/sessions', {
    method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({login:loginName,password}),
  }, fetchImpl);
}
export function listCatalog(session: Session, query = '', fetchImpl: typeof fetch = fetch, signal?: AbortSignal, cursor?: string, category?: string): Promise<CatalogPage> {
  const path = '/v1/catalog/products?query=' + encodeURIComponent(query.trim()) + '&limit=50' +
    (cursor ? '&cursor=' + encodeURIComponent(cursor) : '') +
    (category ? '&category=' + encodeURIComponent(category) : '');
  return jsonRequest<CatalogPage>(path, {method:'GET',headers:headers(session),signal}, fetchImpl);
}
export function listCategories(session:Session,fetchImpl:typeof fetch=fetch,signal?:AbortSignal):Promise<{categories:string[]}>{
 return jsonRequest('/v1/catalog/categories',{method:'GET',headers:headers(session),signal},fetchImpl);
}
export function lookupDraftVariants(session:Session,ids:string[],fetchImpl:typeof fetch=fetch):Promise<CatalogPage>{
 if(!ids.length||ids.length>50)throw new Error('Carrinho deve conter de 1 a 50 variantes');
 return jsonRequest('/v1/catalog/draft-variants?ids='+encodeURIComponent(ids.join(',')),
  {method:'GET',headers:headers(session)},fetchImpl);
}
export function scanCatalog(session:Session,code:string,fetchImpl:typeof fetch=fetch): Promise<CatalogPage> {
  const path='/v1/catalog/products?exact=true&limit=2&query='+encodeURIComponent(code.trim());
  return jsonRequest<CatalogPage>(path,{method:'GET',headers:headers(session)},fetchImpl);
}
export function createProduct(session: Session, payload: ProductPayload, key: string, fetchImpl: typeof fetch = fetch) {
  return jsonRequest<{id:string;name:string;category:string}>('/v1/catalog/products',{
    method:'POST',headers:{...headers(session,key),'content-type':'application/json'},
    body:JSON.stringify(payload),
  }, fetchImpl);
}
export function receiveStock(session: Session, payload: StockReceiptPayload, key: string, fetchImpl: typeof fetch = fetch) {
  return jsonRequest<StockReceiptResult>('/v1/stock/receipts',{
    method:'POST',headers:{...headers(session,key),'content-type':'application/json'},
    body:JSON.stringify(payload),
  }, fetchImpl);
}
export function revokeSession(session: Session, fetchImpl: typeof fetch = fetch) {
  return jsonRequest<{revoked:boolean}>('/v1/auth/sessions/revoke', {
    method:'POST',headers:headers(session),
  }, fetchImpl);
}

export function patchProduct(session:Session,id:string,payload:ProductPatchPayload,key:string,fetchImpl:typeof fetch=fetch) {
 return jsonRequest<{id:string;name:string;category:string;revision:number}>('/v1/catalog/products/'+encodeURIComponent(id),{
  method:'PATCH',headers:{...headers(session,key),'content-type':'application/json'},body:JSON.stringify(payload)
 },fetchImpl);
}
export function patchVariantPrice(session:Session,id:string,payload:VariantPricePayload,key:string,fetchImpl:typeof fetch=fetch) {
 return jsonRequest<{id:string;price_cents:number;revision:number}>('/v1/catalog/variants/'+encodeURIComponent(id),{
  method:'PATCH',headers:{...headers(session,key),'content-type':'application/json'},body:JSON.stringify(payload)
 },fetchImpl);
}
export function adjustStock(session:Session,payload:StockAdjustPayload,key:string,fetchImpl:typeof fetch=fetch) {
 return jsonRequest<StockReceiptResult>('/v1/stock/adjustments',{
  method:'POST',headers:{...headers(session,key),'content-type':'application/json'},body:JSON.stringify(payload)
 },fetchImpl);
}
export function listMovements(session:Session,variantId:string,fetchImpl:typeof fetch=fetch) {
 return jsonRequest<{items:StockMovement[]}>('/v1/stock/movements?variant_id='+encodeURIComponent(variantId),{
  method:'GET',headers:headers(session)
 },fetchImpl);
}
export async function uploadPhoto(session:Session,productId:string,file:Blob,key:string,fetchImpl:typeof fetch=fetch) {
 return jsonRequest<{product_id:string;sha256:string;content_type:string}>(
  '/v1/catalog/products/'+encodeURIComponent(productId)+'/photo',{
  method:'PUT',headers:{...headers(session,key),'content-type':file.type},body:file
 },fetchImpl);
}
export async function fetchProductPhoto(session:Session,productId:string,fetchImpl:typeof fetch=fetch,signal?:AbortSignal) {
 let response:Response;
 try {response=await fetchImpl('/v1/catalog/products/'+encodeURIComponent(productId)+'/thumbnail',{
  headers:headers(session),cache:'no-store',signal
 });} catch {throw new ApiError(0,'NETWORK_ERROR','Imagem indisponível no servidor LAN');}
 if(!response.ok)throw new ApiError(response.status,'IMAGE_UNAVAILABLE','Não foi possível carregar a fotografia');
 return response.blob();
}

export type VariantAttributes={sku:string;color:string;size:string;barcode?:string|null;expected_revision:number};
export function addProductVariant(session:Session,id:string,variant:{
 sku:string;color:string;size:string;barcode?:string|null;price_cents:number;expected_product_revision:number
},key:string,fetchImpl:typeof fetch=fetch){
 return jsonRequest<{id:string;revision:number}>('/v1/catalog/products/'+encodeURIComponent(id)+'/variants',{
  method:'POST',headers:{...headers(session,key),'content-type':'application/json'},body:JSON.stringify(variant)
 },fetchImpl);
}
export function patchVariantAttributes(session:Session,id:string,attributes:VariantAttributes,key:string,fetchImpl:typeof fetch=fetch){
 return jsonRequest<{id:string;revision:number}>('/v1/catalog/variants/'+encodeURIComponent(id)+'/attributes',{
  method:'PATCH',headers:{...headers(session,key),'content-type':'application/json'},body:JSON.stringify(attributes)
 },fetchImpl);
}

/** Read-only projection of canonical products, balances and movement ledger. */
export type StockSpreadsheetRow={
 product_id:string;variant_id:string;name:string;category:string;sku:string;color:string;size:string;
 barcode:string|null;price_cents:number;product_revision:number;variant_revision:number;
 stock_revision:number;on_hand:number;reserved:number;available:number;
 entries:number;sold:number;returns:number;adjustments:number;last_movement_at:string|null;
};
export type StockSpreadsheetPage={
 items:StockSpreadsheetRow[];total:number;offset:number;limit:number;categories:string[];
};
export type SpreadsheetRowPatch={
 name:string;category:string;sku:string;color:string;size:string;
 barcode:string|null;price_cents:number;
 expected_product_revision:number;expected_variant_revision:number;
};
export function listStockSpreadsheet(
 session:Session,options:{query?:string;category?:string;limit?:number;offset?:number}={},
 fetchImpl:typeof fetch=fetch,signal?:AbortSignal
):Promise<StockSpreadsheetPage>{
 const params=new URLSearchParams({
  query:options.query??'',category:options.category??'',
  limit:String(options.limit??50),offset:String(options.offset??0)
 });
 return jsonRequest<StockSpreadsheetPage>('/v1/stock/spreadsheet?'+params.toString(),{
  method:'GET',headers:headers(session),signal
 },fetchImpl);
}
export function patchSpreadsheetRow(
 session:Session,variantId:string,payload:SpreadsheetRowPatch,key:string,fetchImpl:typeof fetch=fetch
):Promise<{id:string;product_id:string;product_revision:number;variant_revision:number;changed:boolean;replayed:boolean}>{
 return jsonRequest('/v1/stock/spreadsheet/rows/'+encodeURIComponent(variantId),{
  method:'PATCH',headers:{...headers(session,key),'content-type':'application/json'},
  body:JSON.stringify(payload)
 },fetchImpl);
}
