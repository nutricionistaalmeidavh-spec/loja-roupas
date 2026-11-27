import type { Variant } from '@loja/domain';

export type ApiVariant = {variant_revision?:number;
  id: string; product_id: string; sku: string; barcode: string | null;
  color: string; size: string; price_cents: number; available: number; revision: number;
};
export type ApiProduct = {id:string;name:string;category:string;revision?:number;has_photo?:boolean;photo_version?:string|null;variants:ApiVariant[]};
export type CatalogPage = { items: ApiProduct[]; next_cursor: string | null };
export type Product = {
  id: string; name: string; category: string; revision:number;hasPhoto:boolean;photoVersion:string|null;
  kind: 'shirt' | 'pants' | 'bag' | 'shoe' | 'dress' | 'skirt' | 'generic';
  variants: Array<Variant & {barcode:string|null;stockRevision:number;variantRevision:number}>;
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
      : /sapato|mocassim|tênis|tenis|sandália|sandalia|calçado/.test(label) ? 'shoe'
      : /vestido/.test(label) ? 'dress'
      : /saia/.test(label) ? 'skirt'
      : /calça|jeans|bermuda|short/.test(label) ? 'pants'
      : /camisa|camiseta|blusa|regata|polo|casaco|jaqueta|suéter/.test(label) ? 'shirt'
      : 'generic';
    return {
      id: p.id, name: p.name, category: p.category, revision:p.revision??1,hasPhoto:p.has_photo??false,photoVersion:p.photo_version??null,kind,
      variants: p.variants.map(v => {
        if (!v.id || !v.sku || !v.color || !v.size ||
          !Number.isSafeInteger(v.price_cents) || v.price_cents < 0)
          throw new Error('Preço ou variante inválida recebida da API');
        if (!Number.isSafeInteger(v.available) || v.available < 0)
          throw new Error('Saldo de estoque inválido recebido da API');
        return { id: v.id, sku: v.sku, color: v.color, size: v.size,
          priceCents: v.price_cents, available: v.available, barcode:v.barcode,stockRevision:v.revision,variantRevision:v.variant_revision??1 };
      }),
    };
  });
}
/**
 * Aceita o jeito como as pessoas digitam dinheiro no Brasil: 149,90 · 1.234,56 ·
 * R$ 1.234 · e também o ponto como decimal vindo de teclado numérico (100.00, 12.5).
 * Ponto seguido de exatamente 3 dígitos é milhar; seguido de 1 ou 2 dígitos no fim é decimal.
 */
export function reaisToCents(raw: string): number {
  let normalized = raw.trim().replace(/^R\$\s*/i, '');
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(normalized)) normalized = normalized.replaceAll('.', '');
  else if (/^\d{1,8}\.\d{1,2}$/.test(normalized)) normalized = normalized.replace('.', ',');
  if (!/^\d{1,8}(,\d{1,2})?$/.test(normalized)) throw new Error('Informe preço em reais, como 149,90');
  const [reais, fraction = ''] = normalized.split(',');
  const cents = Number(reais) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('Preço inválido');
  return cents;
}

const SIZE_ORDER = ['RN', 'BB', 'PP', 'XP', 'P', 'M', 'G', 'GG', 'XG', 'XGG', 'EG', 'EGG', 'EXG', 'G1', 'G2', 'G3', 'G4', 'G5'];
/** Ordena tamanhos como na grade da loja: PP, P, M, G, GG… e numeração em ordem crescente. */
export function sortSizes(sizes: readonly string[]): string[] {
  const rank = (size: string) => {
    const s = size.trim().toUpperCase();
    const known = SIZE_ORDER.indexOf(s);
    if (known >= 0) return [0, known] as const;
    const n = Number(s.replace(',', '.'));
    if (s && Number.isFinite(n)) return [1, n] as const;
    if (/^(U|UN|UNICO|ÚNICO|TAMANHO ÚNICO|TAMANHO UNICO)$/.test(s)) return [3, 0] as const;
    return [2, 0] as const;
  };
  return sizes.map((size, i) => ({ size, i, r: rank(size) }))
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.i - b.i)
    .map(x => x.size);
}
