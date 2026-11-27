import { createHash } from 'node:crypto';

export type VariantDraft = { sku: string; color: string; size: string; price_cents: number; barcode?: string | null };
export type ProductDraft = { name: string; category: string; variants: VariantDraft[] };
const clean = (value: string) => value.trim().replace(/\s+/g, ' ');

export function normalizeProductDraft(value: ProductDraft): ProductDraft {
  if (typeof value?.name !== 'string' || typeof value.category !== 'string' || !Array.isArray(value.variants))
    throw new Error('Dados de produto inválidos');
  const name = clean(value.name), category = clean(value.category);
  if (!name || name.length > 200 || !category || category.length > 100)
    throw new Error('Nome ou categoria inválidos');
  if (value.variants.length < 1 || value.variants.length > 200)
    throw new Error('Quantidade de variantes inválida');
  const skuSet = new Set<string>(), combinationSet = new Set<string>(), barcodeSet = new Set<string>();
  const variants = value.variants.map(v => {
    if (typeof v.sku !== 'string' || typeof v.color !== 'string' || typeof v.size !== 'string')
      throw new Error('Variante inválida');
    const sku = clean(v.sku).toUpperCase(), color = clean(v.color), size = clean(v.size);
    const barcode = v.barcode == null ? null : String(v.barcode).trim();
    if (!/^[A-Z0-9_-]{1,64}$/.test(sku) || !color || !size || color.length > 100 || size.length > 32)
      throw new Error('Variante inválida');
    if (!Number.isSafeInteger(v.price_cents) || v.price_cents < 1)
      throw new Error('Preço em centavos inválido: informe um valor maior que zero');
    if (barcode !== null && (!barcode || barcode.length > 128))
      throw new Error('Código de barras inválido');
    const combination = color.toLowerCase() + '\u0000' + size.toLowerCase();
    if (skuSet.has(sku) || combinationSet.has(combination) || (barcode !== null && barcodeSet.has(barcode)))
      throw new Error('Variante duplicada na grade');
    skuSet.add(sku); combinationSet.add(combination); if (barcode) barcodeSet.add(barcode);
    return { sku, color, size, price_cents: v.price_cents, barcode };
  });
  return { name, category, variants };
}
export function validateReceiptQuantity(quantity: unknown): number {
  if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity <= 0)
    throw new Error('Quantidade de recebimento inválida');
  return quantity;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical((value as Record<string,unknown>)[k])]));
  return value;
}
export function stableFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
