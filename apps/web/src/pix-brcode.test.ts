import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPixPayload, crc16, normalizePixKey, pixText } from './pix-brcode.ts';

test('Pix copia e cola segue o exemplo do manual do BR Code', () => {
  assert.equal(buildPixPayload({ key: '123e4567-e12b-12d1-a456-426655440000', name: 'Fulano de Tal', city: 'BRASILIA' }),
    '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D');
});

test('Pix com valor, nome acentuado e chave de telefone', () => {
  const payload = buildPixPayload({ key: '(11) 98765-4321', name: 'Boutique Ação & Cia', city: 'São Paulo', amountCents: 18990, txid: 'VENDA-42' });
  assert.match(payload, /0114\+5511987654321/);
  assert.match(payload, /5406189\.90/);
  assert.match(payload, /5917Boutique Acao Cia/);
  assert.match(payload, /6009Sao Paulo/);
  assert.match(payload, /62110507VENDA42/);
  assert.equal(payload.slice(-4), crc16(payload.slice(0, -4)));
});

test('chaves Pix normalizadas', () => {
  assert.equal(normalizePixKey('123.456.789-09'), '12345678909');
  assert.equal(normalizePixKey('12.345.678/0001-95'), '12345678000195');
  assert.equal(normalizePixKey(' Loja@Exemplo.com '), 'loja@exemplo.com');
  assert.equal(pixText('Ótima   Loja!', 25), 'Otima Loja');
});
