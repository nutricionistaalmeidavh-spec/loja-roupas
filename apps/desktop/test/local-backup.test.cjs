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

const {isPgDumpArchive}=require('../src/local-backup.cjs');
test('a validação da restauração rejeita dados que não são dump PostgreSQL',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'loja-restore-test-'));
 try{
  const valid=path.join(root,'valid.dump'),fake=path.join(root,'fake.dump');
  await fs.writeFile(valid,Buffer.concat([Buffer.from('PGDMP'),Buffer.alloc(64)]));
  await fs.writeFile(fake,Buffer.from('not a database'));
  assert.equal(await isPgDumpArchive(valid),true);
  assert.equal(await isPgDumpArchive(fake),false);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

const {autoBackupPlan,runAutoBackup}=require('../src/local-backup.cjs');
test('backup automático só roda quando venceu e guarda as últimas cópias',()=>{
 const now=new Date('2026-11-27T12:00:00Z'),h=3600_000;
 assert.equal(autoBackupPlan({files:[],now}).due,true);
 const files=Array.from({length:15},(_,i)=>({name:'loja-auto-'+i+'.dump',mtimeMs:now.getTime()-(i+1)*24*h}));
 const plan=autoBackupPlan({files,now,keep:14});
 assert.equal(plan.due,true);
 assert.deepEqual(plan.remove,['loja-auto-13.dump','loja-auto-14.dump']);
 assert.equal(autoBackupPlan({files:[{name:'loja-auto-x.dump',mtimeMs:now.getTime()-2*h}],now}).due,false);
 assert.equal(autoBackupPlan({files:[{name:'outro.dump',mtimeMs:now.getTime()}],now}).due,true);
});
test('backup automático grava na pasta e apaga as cópias mais antigas',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'loja-auto-'));
 try{
  const folder=path.join(root,'backups'),userData=path.join(root,'dados');
  const dump=f=>fs.writeFile(f,Buffer.alloc(512,7));
  const first=await runAutoBackup({folder,userData,executeDump:dump,now:new Date('2026-11-25T10:00:00Z'),keep:2});
  assert.equal(first.skipped,false);
  const again=await runAutoBackup({folder,userData,executeDump:dump,now:new Date('2026-11-25T11:00:00Z'),keep:2});
  assert.equal(again.skipped,true);
  for(const name of await fs.readdir(folder))await fs.utimes(path.join(folder,name),new Date('2026-11-25T10:00:00Z'),new Date('2026-11-25T10:00:00Z'));
  await runAutoBackup({folder,userData,executeDump:dump,now:new Date('2026-11-26T10:00:00Z'),keep:2});
  const list=(await fs.readdir(folder)).filter(n=>n.startsWith('loja-auto-'));
  assert.equal(list.length,2);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

const {createAutoBackup}=require('../src/auto-backup.cjs');
test('agendador de backup registra sucesso, falha e pasta escolhida',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'loja-agenda-'));
 try{
  let fail=false;
  const runtime={autoBackup:async(folder,force)=>{if(fail)throw Error('disco cheio');return {skipped:false,file:path.join(folder,'x.dump'),force};}};
  const agenda=createAutoBackup({runtime,userData:root,defaultFolder:path.join(root,'bk')});
  assert.equal(agenda.status().overdue,true);
  assert.equal((await agenda.runNow()).ok,true);
  assert.equal(agenda.status().overdue,false);
  fail=true;
  assert.equal((await agenda.runNow()).ok,false);
  assert.equal(agenda.status().last_error,'disco cheio');
  await assert.rejects(agenda.setFolder(path.join(root,'postgres-data','x')),/fora/);
  assert.equal((await agenda.setFolder(path.join(root,'outra'))).folder,path.join(root,'outra'));
  const reloaded=createAutoBackup({runtime,userData:root,defaultFolder:'/ignorado'});
  assert.equal(reloaded.status().folder,path.join(root,'outra'));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
