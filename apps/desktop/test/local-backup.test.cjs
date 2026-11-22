const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {backupFilename,backupDestinationAllowed}=require('../src/local-backup.cjs');

test('nome de arquivo de backup é estável e sem caracteres inválidos',()=>{
 assert.equal(backupFilename(new Date('2026-11-22T10:04:03Z')),'loja-2026-11-22-100403.dump');
});
test('backup nunca sobrescreve o diretório do banco de dados ou a configuração',()=>{
 const root=path.resolve('/tmp/loja'),
       pg=path.join(root,'postgres-data');
 assert.equal(backupDestinationAllowed('/tmp/copia.dump',root),true);
 assert.equal(backupDestinationAllowed(path.join(pg,'copia.dump'),root),false);
 assert.equal(backupDestinationAllowed(path.join(root,'local-runtime.json'),root),false);
 assert.equal(backupDestinationAllowed('/tmp/copia.txt',root),false);
});
