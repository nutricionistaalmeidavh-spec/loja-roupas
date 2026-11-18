import type { CatalogPage } from './catalog-model.ts';

export type StoreAccess = { store_id: string; roles: string[] };
export type LoginResult = { token: string; expires_at: string; stores: StoreAccess[] };
export type Session = { token: string; storeId: string; roles: string[] };
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
async function jsonRequest<T>(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<T> {
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
function headers(session: Session, idempotencyKey?: string): Record<string,string> {
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
export function listCatalog(session: Session, query = '', fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<CatalogPage> {
  const path = '/v1/catalog/products?query=' + encodeURIComponent(query.trim()) + '&limit=50';
  return jsonRequest<CatalogPage>(path, {method:'GET',headers:headers(session),signal}, fetchImpl);
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
