import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
test('health é liveness e ready consulta banco canônico', async () => {
  const app = buildApp({ query: async () => ({ rows: [{ '?column?': 1 }] }) } as any);
  const health = await app.inject('/v1/health');
  const ready = await app.inject('/v1/ready');
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().status, 'alive');
  assert.equal(ready.statusCode, 200);
  await app.close();
});
test('ready responde 503 quando PostgreSQL falha', async () => {
  const app = buildApp({ query: async () => { throw new Error('db down'); } } as any);
  const ready = await app.inject('/v1/ready');
  assert.equal(ready.statusCode, 503);
  assert.equal(ready.json().status, 'unavailable');
  await app.close();
});
