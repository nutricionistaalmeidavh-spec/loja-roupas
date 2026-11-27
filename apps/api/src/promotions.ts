import type { PoolClient } from 'pg';

/*
 * Promoções automáticas aplicadas pelo servidor na cotação e na venda.
 * Cada linha recebe no máximo uma promoção (a que der mais desconto). Como o
 * percentual vai até 90% e "leve X pague Y" exige Y≥1, a venda nunca fica zerada.
 * O desconto da promoção não conta no limite de desconto do caixa.
 */
export type Promotion = { id: string; name: string; kind: 'percent' | 'buy_x_pay_y'; category: string | null;
  percent_bps: number | null; buy_quantity: number | null; pay_quantity: number | null };
export type PromoLine = { category: string; quantity: number; price_cents: number };

function matches(p: Promotion, line: PromoLine) {
  return p.category === null || p.category.toLocaleLowerCase('pt-BR') === line.category.toLocaleLowerCase('pt-BR');
}
/** Desconto por linha de uma única promoção. */
export function promotionDiscount(p: Promotion, lines: readonly PromoLine[]): number[] {
  const out = lines.map(() => 0);
  if (p.kind === 'percent') {
    lines.forEach((l, i) => { if (matches(p, l)) out[i] = Math.floor(l.price_cents * l.quantity * (p.percent_bps ?? 0) / 10000); });
    return out;
  }
  const buy = p.buy_quantity ?? 0, pay = p.pay_quantity ?? 0;
  const units = lines.flatMap((l, i) => matches(p, l) ? Array.from({ length: l.quantity }, () => ({ i, price: l.price_cents })) : []);
  const free = Math.floor(units.length / buy) * (buy - pay);
  // As peças mais baratas saem de graça, como em "leve 3 pague 2".
  units.sort((a, b) => a.price - b.price || a.i - b.i).slice(0, free).forEach(u => { out[u.i] += u.price; });
  return out;
}
/** Melhor promoção de cada linha. */
export function bestPromotions(promotions: readonly Promotion[], lines: readonly PromoLine[]) {
  const cents = lines.map(() => 0), names: (string | null)[] = lines.map(() => null);
  for (const p of promotions) {
    const d = promotionDiscount(p, lines);
    d.forEach((value, i) => { if (value > cents[i]) { cents[i] = Math.min(value, lines[i].price_cents * lines[i].quantity); names[i] = p.name; } });
  }
  return { cents: cents.map(c => Math.max(0, c)), names };
}
export async function activePromotions(db: Pick<PoolClient, 'query'>, storeId: string) {
  const q = await db.query<Promotion>(`SELECT p.id::text,p.name,p.kind,p.category,p.percent_bps,p.buy_quantity,p.pay_quantity
    FROM retail_promotions p JOIN stores s ON s.id=p.store_id
    WHERE p.store_id=$1 AND p.active AND (now() AT TIME ZONE coalesce(s.timezone,'America/Sao_Paulo'))::date BETWEEN p.starts_on AND p.ends_on
    ORDER BY p.created_at,p.id`, [storeId]);
  return q.rows;
}
export async function variantCategories(db: Pick<PoolClient, 'query'>, storeId: string, ids: readonly string[]) {
  const q = await db.query<{ id: string; category: string }>(`SELECT v.id::text,p.category FROM product_variants v
    JOIN products p ON p.id=v.product_id AND p.store_id=v.store_id WHERE v.store_id=$1 AND v.id=ANY($2::uuid[])`, [storeId, ids]);
  return new Map(q.rows.map(r => [r.id.toLowerCase(), r.category]));
}
/** Desconto de promoção por linha, na ordem recebida. */
export async function linePromotions(db: Pick<PoolClient, 'query'>, storeId: string,
  lines: ReadonlyArray<{ variant_id: string; quantity: number; price_cents: number }>) {
  const promotions = await activePromotions(db, storeId);
  if (!promotions.length) return { cents: lines.map(() => 0), names: lines.map(() => null as string | null) };
  const categories = await variantCategories(db, storeId, lines.map(l => l.variant_id));
  return bestPromotions(promotions, lines.map(l => ({ category: categories.get(l.variant_id.toLowerCase()) ?? '', quantity: l.quantity, price_cents: l.price_cents })));
}
