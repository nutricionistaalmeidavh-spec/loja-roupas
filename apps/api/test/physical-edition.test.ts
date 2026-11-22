import test from 'node:test';
import assert from 'node:assert/strict';
import {editionFromEnv,blockedInPhysicalEdition} from '../src/physical-edition.ts';

test('a edição física é opt-in e o núcleo aberto permanece completo',()=>{
 assert.equal(editionFromEnv({}),'full');
 assert.equal(editionFromEnv({LOJA_EDITION:'physical'}),'physical');
 assert.equal(editionFromEnv({LOJA_EDITION:'invalid'}),'full');
});
test('edição física bloqueia canais online inclusive pela API',()=>{
 for(const url of ['/vitrine/123','/v1/storefront/id','/v1/management/storefront/pickup',
  '/v1/management/marketplace/status','/v1/management/pickup-orders',
  '/v1/pickup-orders/id','/v1/management/storefront/variants/id'])
  assert.equal(blockedInPhysicalEdition(url),true,url);
 for(const url of ['/v1/sales','/v1/stock/spreadsheet','/v1/management/purchases','/v1/catalog/products','/v1/management/expenses'])
  assert.equal(blockedInPhysicalEdition(url),false,url);
});
