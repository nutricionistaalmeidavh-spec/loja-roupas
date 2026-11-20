import test from 'node:test';
import assert from 'node:assert/strict';
import { colorSwatch } from './visual-colors.ts';

test('cores frequentes recebem representação verdadeira e nomes normalizados',()=>{
 assert.equal(colorSwatch('Vermelho').background,'#dc2626');
 assert.equal(colorSwatch('AZUL').background,'#2563eb');
 assert.equal(colorSwatch('preto').known,true);
 assert.equal(colorSwatch('#abcdef').background,'#abcdef');
});
test('cores desconhecidas não são falsamente apresentadas como cinza',()=>{
 const color=colorSwatch('Acqua fantasia');
 assert.equal(color.known,false);
 assert.ok(color.label);
 assert.equal(color.background,'#f1f5f9');
});
