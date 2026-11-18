import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePort } from '../src/config.ts';
test('PORT sem configuração usa 3000', () => { assert.equal(parsePort(undefined), 3000); });
test('PORT inválida falha fechada', () => {
  for (const port of ['0', '-1', '65536', '1.5', 'abc', '']) {
    assert.throws(() => parsePort(port));
  }
});
