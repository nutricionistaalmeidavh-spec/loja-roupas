import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { resetLocalManagerPassword, validateRecoveryInput } from '../src/reset-local-admin.ts';
import { verifyPassword } from '../src/security.ts';

test('recuperação local exige login e senha longa',()=>{
 assert.deepEqual(validateRecoveryInput({login:' Admin ',password:'senha segura 123!'}),{
  login:'admin',password:'senha segura 123!'
 });
 assert.throws(()=>validateRecoveryInput({login:'admin',password:'fraca'}));
 assert.throws(()=>validateRecoveryInput({login:'admin; DROP TABLE users',password:'senha segura 123!'}));
});

test('redefinição offline troca somente hash do gestor e revoga sessões, sem remover dados',async()=>{
 const calls:Array<{sql:string; params?:unknown[]}>= [];
 const client={
  async query(sql:string,params?:unknown[]){
   calls.push({sql,params});
   if(sql.includes('SELECT u.id::text'))return {rowCount:1,rows:[{id:'manager-id'}]};
   return {rowCount:1,rows:[]};
  },
  release(){}
 };
 const db={async connect(){return client}} as unknown as Pick<Pool,'connect'>;
 await resetLocalManagerPassword(db,{login:'Admin',password:'senha NOVA e forte 2026'});
 assert.equal(calls[0].sql,'BEGIN');
 assert.ok(calls.some(x=>x.sql==='COMMIT'));
 assert.ok(calls.some(x=>x.sql.includes("r.role_code='manager'")));
 const update=calls.find(x=>x.sql.startsWith('UPDATE users'));
 assert.ok(update);
 assert.equal(update!.params![1],'manager-id');
 assert.notEqual(update!.params![0],'senha NOVA e forte 2026');
 assert.equal(await verifyPassword('senha NOVA e forte 2026',String(update!.params![0])),true);
 assert.ok(calls.some(x=>x.sql.startsWith('UPDATE auth_sessions')));
 assert.ok(calls.every(x=>!x.sql.includes('DELETE FROM')));
});

test('administrador inexistente não pode redefinir outra conta',async()=>{
 let rolledBack=false,released=false;
 const client={
  async query(sql:string){
   if(sql.includes('SELECT u.id::text'))return {rowCount:0,rows:[]};
   if(sql==='ROLLBACK')rolledBack=true;
   return {rowCount:1,rows:[]};
  },
  release(){released=true}
 };
 const db={async connect(){return client}} as unknown as Pick<Pool,'connect'>;
 await assert.rejects(resetLocalManagerPassword(db,{login:'caixa',password:'senha nova e longa 123'}),/Administrador local não encontrado/);
 assert.equal(rolledBack,true);assert.equal(released,true);
});
