import test from 'node:test';
import assert from 'node:assert/strict';
import { tourStepsFor, tourStorageKey, shouldShowTour } from './tour-model.ts';

test('tour completo do gestor cobre PDV, catálogo, estoque, caixa, gestão e online',()=>{
 const steps=tourStepsFor(['manager']);
 assert.ok(steps.length>=10);
 for(const page of ['pdv','produtos','estoque','caixa','gestao'])
  assert.ok(steps.some(step=>step.page===page));
 assert.ok(steps.some(step=>step.id==='inteligencia'));
 assert.ok(steps.some(step=>step.id==='vitrine'));
});
test('permissões não expõem módulos indisponíveis',()=>{
 const cashier=tourStepsFor(['cashier']);
 assert.ok(cashier.some(s=>s.page==='caixa'));
 assert.ok(cashier.every(s=>s.page==='pdv'||s.page==='caixa'));
 const stocker=tourStepsFor(['stocker']);
 assert.ok(stocker.every(s=>s.page==='pdv'||s.page==='estoque'));
});
test('progresso é local por loja e perfil, nunca contém token',()=>{
 const key=tourStorageKey('store-123',['cashier','manager']);
 assert.equal(key,tourStorageKey('store-123',['manager','cashier']));
 assert.notEqual(key,tourStorageKey('store-456',['manager','cashier']));
 assert.equal(shouldShowTour(null),true);
 assert.equal(shouldShowTour('complete'),false);
 assert.equal(shouldShowTour('skipped'),false);
});
