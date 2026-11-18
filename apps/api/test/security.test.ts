import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, issueSession, hasPermission, hashSessionToken } from '../src/security.ts';

test('hash de senha com salt diferente e verificação estrita', async () => {
  const a = await hashPassword('Minha senha segura 123!');
  const b = await hashPassword('Minha senha segura 123!');
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('Minha senha segura 123!', a), true);
  assert.equal(await verifyPassword('senha incorreta', a), false);
  assert.equal(await verifyPassword('Minha senha segura 123!', 'bad'), false);
});
test('rejeita senha curta', async () => {
  await assert.rejects(() => hashPassword('123'), /12/);
});
test('sessão gera token opaco armazenado somente por hash', () => {
  const { token, tokenHash } = issueSession();
  assert.ok(token.length >= 40);
  assert.match(tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(token, tokenHash);
  assert.equal(tokenHash, hashSessionToken(token));
});
test('nega permissão por padrão e separa o papel de operador', () => {
  assert.equal(hasPermission(['cashier'], 'sale.commit'), true);
  assert.equal(hasPermission(['cashier'], 'stock.adjust'), false);
  assert.equal(hasPermission(['unknown'], 'catalog.read'), false);
  assert.equal(hasPermission(['manager'], 'stock.adjust'), true);
});
