import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeStockItem,onlineOrderTransition} from '../worker.mjs';
test('catálogo recebe nomes e preços válidos pelo PostgreSQL local',()=>{
 const item={id:'e85245c6-52b6-45c3-a706-4874b526d0ee',product_id:'2e8dd905-c24c-4d83-a60e-2900f83146c5',name:'Vestido social longo',category:'Feminino',color:'Marrom dourado',size:'GG',price_cents:140000,available:3,revision:1730000000000,published:true,photo_url:null};
 assert.equal(normalizeStockItem(item).revision,1730000000000);
 assert.equal(normalizeStockItem({...item,color:'Azul e branco floral com listras finas'}).color,'Azul e branco floral com listras finas');
});
test('uma retirada já aceita pode ser recusada pelo operador sem ficar presa online',()=>{
 assert.equal(onlineOrderTransition('pending','accepted'),true);
 assert.equal(onlineOrderTransition('accepted','rejected'),true);
 assert.equal(onlineOrderTransition('rejected','accepted'),false);
 assert.equal(onlineOrderTransition('accepted','fulfilled'),true);
});
