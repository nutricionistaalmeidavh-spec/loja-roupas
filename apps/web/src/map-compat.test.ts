import test from 'node:test';
import assert from 'node:assert/strict';
import {installMapCompatibility} from './map-compat.ts';

type PolyfilledMap<K,V>=Map<K,V>&{getOrInsertComputed:(key:K,calculate:(key:K)=>V)=>V};

test('compatibilidade com Electron: getOrInsertComputed retorna valor existente sem recalcular',()=>{
 const map=new Map<string,number>() as PolyfilledMap<string,number>;
 map.set('A',0);
 let calls=0;
 const value=map.getOrInsertComputed('A',()=>{calls++;return 123;});
 assert.equal(value,0);
 assert.equal(calls,0);
});

test('compatibilidade com Electron: callback recebe chave, grava ausência e trata undefined existente',()=>{
 const map=new Map<string,number|undefined>() as PolyfilledMap<string,number|undefined>;
 let calls=0;
 assert.equal(map.getOrInsertComputed('new',key=>{calls++;assert.equal(key,'new');return 14;}),14);
 assert.equal(map.get('new'),14);
 map.set('empty',undefined);
 assert.equal(map.getOrInsertComputed('empty',()=>{calls++;return 19;}),undefined);
 assert.equal(calls,1);
});

test('instala compatibilidade quando a implementação nativa não existe',()=>{
 const existing=Object.getOwnPropertyDescriptor(Map.prototype,'getOrInsertComputed');
 try{
  Reflect.deleteProperty(Map.prototype,'getOrInsertComputed');
  installMapCompatibility();
  const map=new Map<string,string>() as PolyfilledMap<string,string>;
  assert.equal(map.getOrInsertComputed('SKU',key=>'valor '+key),'valor SKU');
  assert.equal(map.getOrInsertComputed('SKU',()=>{throw new Error('não recalcular');}),'valor SKU');
 }finally{
  if(existing)Object.defineProperty(Map.prototype,'getOrInsertComputed',existing);
  else Reflect.deleteProperty(Map.prototype,'getOrInsertComputed');
  installMapCompatibility();
 }
});
