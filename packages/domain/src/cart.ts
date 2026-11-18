/** Apenas rascunho no frontend. A API valida preços e estoque na transação real. */
export type Variant = Readonly<{
  id: string;
  sku: string;
  color: string;
  size: string;
  priceCents: number;
  available: number;
}>;
export type DraftLine = Readonly<{ variant: Variant; quantity: number }>;

export function resolveVariant(variants: readonly Variant[], color: string, size: string): Variant | null {
  return variants.find((variant) => variant.color === color && variant.size === size) ?? null;
}

export function addToDraft(lines: readonly DraftLine[], variant: Variant): DraftLine[] {
  if (!variant.id || !variant.sku) throw new Error('Variante inválida');
  if (!Number.isSafeInteger(variant.priceCents) || variant.priceCents < 0) throw new Error('Preço inválido');
  if (!Number.isSafeInteger(variant.available) || variant.available < 0) throw new Error('Saldo inválido');
  if (variant.available === 0) throw new Error('Variante indisponível');
  const existing = lines.find((line) => line.variant.id === variant.id);
  const nextQty = (existing?.quantity ?? 0) + 1;
  if (nextQty > variant.available) throw new Error('Quantidade acima do saldo');
  return existing
    ? lines.map((line) => line.variant.id === variant.id ? { ...line, quantity: nextQty } : line)
    : [...lines, { variant, quantity: 1 }];
}

export function draftTotalCents(lines: readonly DraftLine[]): number {
  const total = lines.reduce((sum, line) => sum + line.quantity * line.variant.priceCents, 0);
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Total inválido');
  return total;
}
