import test from 'node:test';
import assert from 'node:assert/strict';
import {appendCatalogPage} from './catalog-pagination.ts';

test('acrescenta segunda página sem duplicar IDs e preserva a ordem',()=>{
 const initial=[{id:'a',name:'A'},{id:'b',name:'B'}];
 const page=[{id:'b',name:'B atualizado'},{id:'c',name:'C'}];
 assert.deepEqual(appendCatalogPage(initial,page).map(p=>p.id),['a','b','c']);
 assert.equal(appendCatalogPage(initial,page)[1].name,'B atualizado');
});
test('nova busca substitui dados antigos quando cursor é nulo',()=>{
 assert.deepEqual(appendCatalogPage([{id:'old'}],[{id:'new'}],false),[{id:'new'}]);
});