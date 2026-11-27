/*
 * Preferências da notinha (cupom não fiscal) guardadas neste computador:
 * papel, impressora do Windows e impressão automática ao finalizar a venda.
 */
export type ReceiptPaper = 58 | 80 | 210;
export type ReceiptSettings = { paper: ReceiptPaper; printer: string; autoPrint: boolean };

export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = { paper: 80, printer: '', autoPrint: false };
const PAPERS: readonly ReceiptPaper[] = [58, 80, 210];

/** Colunas de texto por papel: bobina 58 mm, bobina 80 mm e A4 meia folha. */
export function receiptColumns(paper: ReceiptPaper): 32 | 42 | 90 {
  return paper === 58 ? 32 : paper === 80 ? 42 : 90;
}
export function paperLabel(paper: ReceiptPaper) {
  return paper === 210 ? 'A4 meia folha' : paper + ' mm (bobina)';
}
export function parseReceiptSettings(raw: string | null): ReceiptSettings {
  try {
    const value = JSON.parse(raw ?? 'null') as Partial<ReceiptSettings> | null;
    if (!value || typeof value !== 'object') return { ...DEFAULT_RECEIPT_SETTINGS };
    return {
      paper: PAPERS.includes(value.paper as ReceiptPaper) ? value.paper as ReceiptPaper : DEFAULT_RECEIPT_SETTINGS.paper,
      printer: typeof value.printer === 'string' ? value.printer.slice(0, 256) : '',
      autoPrint: value.autoPrint === true,
    };
  } catch { return { ...DEFAULT_RECEIPT_SETTINGS }; }
}
const key = (storeId: string) => 'loja:notinha:' + storeId;
export function loadReceiptSettings(storeId: string): ReceiptSettings {
  try { return parseReceiptSettings(localStorage.getItem(key(storeId))); } catch { return { ...DEFAULT_RECEIPT_SETTINGS }; }
}
export function saveReceiptSettings(storeId: string, settings: ReceiptSettings) {
  try { localStorage.setItem(key(storeId), JSON.stringify(settings)); } catch { /* armazenamento indisponível */ }
}
