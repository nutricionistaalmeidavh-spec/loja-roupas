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

type PolyfilledWeakMap<K extends object,V>=WeakMap<K,V>&{getOrInsertComputed:(key:K,compute:(key:K)=>V)=>V};

test('WeakMap.getOrInsertComputed preserva cache por identidade e resultado indefinido',()=>{
 const weak=new WeakMap<object,unknown>() as PolyfilledWeakMap<object,unknown>;
 const key={name:'estoque'};
 let called=0;
 assert.equal(weak.getOrInsertComputed(key,k=>{called++;return k;}),key);
 assert.equal(weak.getOrInsertComputed(key,()=>{called++;return null;}),key);
 assert.equal(called,1);
 const other={};
 weak.set(other,undefined);
 assert.equal(weak.getOrInsertComputed(other,()=>{called++;return 1;}),undefined);
 assert.equal(called,1);
});

test('instala compatibilidade para WeakMap independentemente de Map nativo',()=>{
 const mapOwn=Object.getOwnPropertyDescriptor(Map.prototype,'getOrInsertComputed');
 const weakOwn=Object.getOwnPropertyDescriptor(WeakMap.prototype,'getOrInsertComputed');
 try{
  Reflect.deleteProperty(WeakMap.prototype,'getOrInsertComputed');
  installMapCompatibility();
  const w=new WeakMap<object,number>() as PolyfilledWeakMap<object,number>;
  assert.equal(w.getOrInsertComputed({},()=>4),4);
 }finally{
  if(mapOwn)Object.defineProperty(Map.prototype,'getOrInsertComputed',mapOwn);
  if(weakOwn)Object.defineProperty(WeakMap.prototype,'getOrInsertComputed',weakOwn);
  else Reflect.deleteProperty(WeakMap.prototype,'getOrInsertComputed');
  installMapCompatibility();
 }
});
