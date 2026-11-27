/*
 * Venda com resultado incerto: o servidor pode ter gravado, mas a resposta não chegou
 * (rede caiu, app recarregado). Guardamos uma marca por caixa para que o carrinho
 * recuperado depois de reabrir venha com aviso, em vez de virar uma venda nova sem alerta.
 */
const prefix = 'loja:venda-incerta:';
export function markUncertainSale(cashSessionId: string) {
  try { sessionStorage.setItem(prefix + cashSessionId, String(Date.now())); } catch { /* armazenamento indisponível */ }
}
export function clearUncertainSale(cashSessionId: string | null) {
  if (!cashSessionId) return;
  try { sessionStorage.removeItem(prefix + cashSessionId); } catch { /* armazenamento indisponível */ }
}
export function hasUncertainSale(cashSessionId: string | null) {
  if (!cashSessionId) return false;
  try { return sessionStorage.getItem(prefix + cashSessionId) !== null; } catch { return false; }
}
