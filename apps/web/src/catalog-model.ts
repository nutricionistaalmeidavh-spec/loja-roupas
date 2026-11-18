import type { Variant } from '@loja/domain';

export type ApiVariant = {
  id: string; product_id: string; sku: string; barcode: string | null;
  color: string; size: string; price_cents: number; available: number; revision: number;
};
export type ApiProduct = { id: string; name: string; category: string; variants: ApiVariant[] };
export type CatalogPage = { items: ApiProduct[]; next_cursor: string | null };
export type Product = {
  id: string; name: string; category: string;
  kind: 'shirt' | 'pants' | 'bag' | 'shoe';
  variants: Array<Variant & {barcode:string|null}>;
};
export function productCanAdd(variant: Variant | null | undefined): boolean {
  return Boolean(variant && Number.isSafeInteger(variant.available) && variant.available > 0);
}
export function mapCatalog(page: CatalogPage): Product[] {
  if (!page || !Array.isArray(page.items)) throw new Error('Catálogo inválido recebido da API');
  return page.items.map(p => {
    if (!p.id || !p.name || !Array.isArray(p.variants)) throw new Error('Produto inválido recebido da API');
    const label = (p.name + ' ' + p.category).toLowerCase();
    const kind: Product['kind'] = /bolsa|mochila/.test(label) ? 'bag'
      : /sapato|mocassim|tênis|sandália|calçado/.test(label) ? 'shoe'
      : /calça|jeans|bermuda|short/.test(label) ? 'pants' : 'shirt';
    return {
      id: p.id, name: p.name, category: p.category, kind,
      variants: p.variants.map(v => {
        if (!v.id || !v.sku || !v.color || !v.size ||
          !Number.isSafeInteger(v.price_cents) || v.price_cents < 0)
          throw new Error('Preço ou variante inválida recebida da API');
        if (!Number.isSafeInteger(v.available) || v.available < 0)
          throw new Error('Saldo de estoque inválido recebido da API');
        return { id: v.id, sku: v.sku, color: v.color, size: v.size,
          priceCents: v.price_cents, available: v.available, barcode:v.barcode };
      }),
    };
  });
}
export function reaisToCents(raw: string): number {
  const normalized = raw.trim();
  if (!/^\d{1,8}(,\d{1,2})?$/.test(normalized)) throw new Error('Informe preço em reais, como 149,90');
  const [reais, fraction = ''] = normalized.split(',');
  const cents = Number(reais) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('Preço inválido');
  return cents;
}
