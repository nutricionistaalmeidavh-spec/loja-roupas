import test from 'node:test';
import assert from 'node:assert/strict';
import { bestPromotions, promotionDiscount } from '../src/promotions.ts';
import type { Promotion } from '../src/promotions.ts';

const base = { id: 'x', category: null, percent_bps: null, buy_quantity: null, pay_quantity: null };
test('percentual por categoria só desconta as peças da categoria', () => {
  const p: Promotion = { ...base, name: 'Jeans 20%', kind: 'percent', category: 'Jeans', percent_bps: 2000 };
  assert.deepEqual(promotionDiscount(p, [{ category: 'jeans', quantity: 2, price_cents: 10000 }, { category: 'Blusas', quantity: 1, price_cents: 5000 }]), [4000, 0]);
});
test('leve 3 pague 2 dá a peça mais barata', () => {
  const p: Promotion = { ...base, name: 'Leve 3 pague 2', kind: 'buy_x_pay_y', buy_quantity: 3, pay_quantity: 2 };
  assert.deepEqual(promotionDiscount(p, [{ category: 'A', quantity: 2, price_cents: 8000 }, { category: 'B', quantity: 1, price_cents: 5000 }]), [0, 5000]);
  assert.deepEqual(promotionDiscount(p, [{ category: 'A', quantity: 5, price_cents: 1000 }]), [1000]);
  assert.deepEqual(promotionDiscount(p, [{ category: 'A', quantity: 6, price_cents: 1000 }]), [2000]);
});
test('cada linha fica com a melhor promoção', () => {
  const a: Promotion = { ...base, name: '10% loja', kind: 'percent', percent_bps: 1000 };
  const b: Promotion = { ...base, name: 'Queima 90%', kind: 'percent', category: 'Saldo', percent_bps: 9000 };
  const r = bestPromotions([a, b], [{ category: 'Saldo', quantity: 1, price_cents: 1000 }, { category: 'Novidades', quantity: 1, price_cents: 1000 }]);
  assert.deepEqual(r.cents, [900, 100]);
  assert.deepEqual(r.names, ['Queima 90%', '10% loja']);
  const free = bestPromotions([{ ...base, name: 'Leve 2 pague 1', kind: 'buy_x_pay_y', buy_quantity: 2, pay_quantity: 1 }], [{ category: 'A', quantity: 1, price_cents: 100 }, { category: 'A', quantity: 1, price_cents: 100 }]);
  assert.deepEqual(free.cents, [100, 0]);
});
