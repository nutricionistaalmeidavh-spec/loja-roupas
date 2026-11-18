import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProductDraft, validateReceiptQuantity, stableFingerprint } from '../src/catalog.ts';

test('normaliza SKU e nomes e rejeita grade duplicada', () => {
  const p = normalizeProductDraft({ name: '  Camisa    linen  ', category: ' Masculino ', variants: [
    { sku: ' cam-az-m ', color: 'Azul', size: 'M', price_cents: 14990 }
  ] });
  assert.equal(p.name, 'Camisa linen');
  assert.equal(p.variants[0].sku, 'CAM-AZ-M');
  assert.throws(() => normalizeProductDraft({ name: 'Blusa', category: 'Feminino', variants: [
    { sku: 'a', color: 'Azul', size: 'M', price_cents: 100 },
    { sku: 'b', color: 'Azul', size: 'M', price_cents: 200 }
  ] }), /duplicada/i);
});
test('nega preço fracionário fora do contrato de centavos', () => {
  assert.throws(() => normalizeProductDraft({ name: 'T', category: 'V', variants: [
    { sku: 'a', color: 'A', size: 'M', price_cents: 29.99 }
  ] }), /preço/i);
});
test('recebimentos exigem quantidade positiva e inteira', () => {
  assert.equal(validateReceiptQuantity(3), 3);
  for (const bad of [-1, 0, 1.5, NaN, Number.MAX_SAFE_INTEGER+1])
    assert.throws(() => validateReceiptQuantity(bad));
});
test('fingerprint é canônico independente da ordem de chaves', () => {
  assert.equal(stableFingerprint({ sku:'x', quantity:2 }), stableFingerprint({ quantity:2, sku:'x' }));
  assert.notEqual(stableFingerprint({ sku:'x', quantity:2 }), stableFingerprint({ quantity:3, sku:'x' }));
});
