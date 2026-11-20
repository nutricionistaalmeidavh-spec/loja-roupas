const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {makeDatabaseUrl,validateBootstrap,expectedBinaries}=require('../src/local-runtime.cjs');

test('URL do banco local não aceita conexão externa e usa senha codificada',()=>{
 const url=new URL(makeDatabaseUrl('abc?+#',54399));
 assert.equal(url.hostname,'127.0.0.1');
 assert.equal(url.port,'54399');
 assert.equal(decodeURIComponent(url.password),'abc?+#');
});
test('primeiro acesso exige dados de loja e senha forte antes do bootstrap',()=>{
 assert.throws(()=>validateBootstrap({name:'',login:'admin',password:'a'.repeat(12)}));
 assert.throws(()=>validateBootstrap({name:'Loja',login:'admin',password:'short'}));
 assert.deepEqual(validateBootstrap({name:'Loja exemplo',login:'Admin',password:'senha-forte-123'}),{name:'Loja exemplo',login:'admin',password:'senha-forte-123'});
});
test('Windows requer PostgreSQL local completo, não Docker nem rede',()=>{
 const paths=expectedBinaries('C:/resources');
 assert.ok(paths.some(p=>p.endsWith(path.win32.join('postgres','bin','initdb.exe'))||p.endsWith('postgres/bin/initdb.exe')));
 assert.ok(paths.some(p=>p.includes('pg_ctl.exe')));
});
