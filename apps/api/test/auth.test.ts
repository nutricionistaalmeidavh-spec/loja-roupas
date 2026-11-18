import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { hashPassword, hashSessionToken } from '../src/security.ts';
import type { Pool } from 'pg';

const storeId='79a43ea3-ff29-4b7c-b7e8-9c78fe139e30';
function fakeDatabase(passwordHash:string) {
  const state:{sessionHash?:string}={};
  const calls:{sql:string;params?:unknown[]}[]=[];
  const query=async(sql:string,params?:unknown[])=>{
    calls.push({sql,params});
    if(sql.includes('password_hash FROM users'))return {rowCount:1,rows:[{id:'user-1',password_hash:passwordHash}]};
    if(sql.includes('array_agg(role_code) AS roles FROM user_store_roles'))
      return {rowCount:1,rows:[{store_id:storeId,roles:['manager']}]};
    if(sql.includes('INSERT INTO auth_sessions')) {state.sessionHash=String(params?.[1]);return {rowCount:1,rows:[]};}
    if(sql.includes('FROM auth_sessions s')) {
      const match=params?.[0]===state.sessionHash && params?.[1]===storeId;
      return {rowCount:match?1:0,rows:match?[{user_id:'user-1',store_id:storeId,roles:['manager']}]:[]};
    }
    return {rowCount:0,rows:[]};
  };
  return {query,state,calls};
}
test('login não armazena token em texto e requer loja autorizada', async()=>{
  const password='Senha longa e local 456!';
  const db=fakeDatabase(await hashPassword(password));
  const app=buildApp(db as unknown as Pick<Pool,'query'>);
  const login=await app.inject({method:'POST',url:'/v1/auth/sessions',payload:{login:'admin',password}});
  assert.equal(login.statusCode,200);
  const token=login.json().token;
  assert.equal(db.state.sessionHash,hashSessionToken(token));
  const noAuth=await app.inject({url:'/v1/auth/me',headers:{'x-store-id':storeId}});
  assert.equal(noAuth.statusCode,401);
  const me=await app.inject({url:'/v1/auth/me',headers:{authorization:`Bearer ${token}`,'x-store-id':storeId}});
  assert.equal(me.statusCode,200);
  assert.equal(me.json().store_id,storeId);
  const other=await app.inject({url:'/v1/auth/me',headers:{authorization:`Bearer ${token}`,'x-store-id':'be98429d-2001-42dc-a617-9913381d2734'}});
  assert.equal(other.statusCode,401);
  await app.close();
});
test('login inválido não emite token de sessão',async()=>{
  const db=fakeDatabase(await hashPassword('Senha longa e local 456!'));
  const app=buildApp(db as unknown as Pick<Pool,'query'>);
  const r=await app.inject({method:'POST',url:'/v1/auth/sessions',payload:{login:'admin',password:'invalida'}});
  assert.equal(r.statusCode,401);
  assert.equal(db.state.sessionHash,undefined);
  await app.close();
});
