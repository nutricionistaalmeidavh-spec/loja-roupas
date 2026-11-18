import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVariant, addToDraft, draftTotalCents } from '../src/cart.ts';
const variations = [
  { id: 'v-1', sku: 'CAM-AZ-M', color: 'Azul', size: 'M', priceCents: 14990, available: 2 },
  { id: 'v-2', sku: 'CAM-AZ-G', color: 'Azul', size: 'G', priceCents: 14990, available: 0 },
];
test('seleciona a variante exata e nao a combinacao aproximada', () => {
  assert.equal(resolveVariant(variations, 'Azul', 'M')?.sku, 'CAM-AZ-M');
  assert.equal(resolveVariant(variations, 'Preto', 'M'), null);
});
test('nao adiciona variante sem saldo ou desconhecida', () => {
  assert.throws(() => addToDraft([], variations[1]), /indisponível/);
  assert.throws(() => addToDraft([], { ...variations[0], id: '' }), /inválida/);
});
test('incrementa o mesmo SKU sem mutar o carrinho existente', () => {
  const first = addToDraft([], variations[0]);
  const second = addToDraft(first, variations[0]);
  assert.equal(first[0].quantity, 1);
  assert.equal(second[0].quantity, 2);
  assert.equal(second.length, 1);
  assert.equal(draftTotalCents(second), 29980);
  assert.throws(() => addToDraft(second, variations[0]), /saldo/i);
});
test('evita preços em ponto flutuante e quantidades inválidas', () => {
  assert.throws(() => addToDraft([], { ...variations[0], priceCents: 12.5 }), /Preço/);
  assert.throws(() => addToDraft([], { ...variations[0], available: -1 }), /saldo/i);
});
