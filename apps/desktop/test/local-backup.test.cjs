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

const fs=require('node:fs/promises');
const os=require('node:os');
const {writeBackup}=require('../src/local-backup.cjs');
test('backup custom é gravado atomicamente e recusa sobrescrever arquivo anterior',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'loja-backup-test-'));
 const destination=path.join(root,'copia.dump');
 try{
  const result=await writeBackup({destination,userData:path.join(root,'loja'),executeDump:f=>fs.writeFile(f,Buffer.alloc(1024,33))});
  assert.equal(result.bytes,1024);
  assert.match(result.sha256,/^[a-f0-9]{64}$/);
  assert.equal((await fs.readFile(destination)).length,1024);
  await assert.rejects(writeBackup({destination,userData:path.join(root,'loja'),executeDump:()=>{throw Error('não executar');}}),/existe/);
  assert.deepEqual((await fs.readdir(root)).filter(x=>x.includes('.partial-')),[]);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
