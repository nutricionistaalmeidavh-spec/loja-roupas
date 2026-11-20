const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,readFile,writeFile,mkdir,readdir,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {compareVersions,selectRelease,checkForUpdate,downloadVerified,parseSha256,backupBeforeUpdate}=require('../src/updates.cjs');
const RELEASE='https://github.com/nutricionistaalmeidavh-spec/loja-roupas/releases/download/v0.2.0/Loja-de-Roupas-Setup-x64.exe';
const HASH='https://github.com/nutricionistaalmeidavh-spec/loja-roupas/releases/download/v0.2.0/SHA256SUMS';
const API='https://api.github.com/repos/nutricionistaalmeidavh-spec/loja-roupas/releases/latest';
const release={tag_name:'v0.2.0',draft:false,prerelease:false,body:'Correções de estabilidade\nNovo estoque',assets:[
 {name:'Loja-de-Roupas-Setup-x64.exe',browser_download_url:RELEASE,size:5},
 {name:'SHA256SUMS',browser_download_url:HASH,size:120}
]};
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
test('comparação numérica de versões impede downgrade e rejeita tags inesperadas',()=>{
 assert.ok(compareVersions('0.2.0','0.1.99')>0);
 assert.equal(compareVersions('v1.0.0','1.0.0'),0);
 assert.ok(compareVersions('1.0.1','1.1.0')<0);
 assert.throws(()=>compareVersions('1.0.0-beta','1.0.0'),/versão/i);
});
test('somente release estável publicada e EXE + SHA256SUMS do repositório são aceitos',()=>{
 assert.equal(selectRelease({...release,draft:true},'0.1.0'),null);
 assert.equal(selectRelease({...release,prerelease:true},'0.1.0'),null);
 assert.equal(selectRelease(release,'0.2.0'),null);
 assert.equal(selectRelease(release,'0.3.0'),null);
 const latest=selectRelease(release,'0.1.0');
 assert.equal(latest.version,'0.2.0');
 assert.equal(latest.notes,release.body);
 assert.equal(latest.assetUrl,RELEASE);
 assert.throws(()=>selectRelease({...release,assets:[{...release.assets[0],browser_download_url:'http://evil.example/setup.exe'},release.assets[1]]},'0.1.0'),/URL|URL inválida|origem/i);
 assert.equal(selectRelease({...release,assets:[release.assets[0]]},'0.1.0'),null);
});
test('checagem ao abrir faz APENAS requisição de metadados, sem baixar instalador',async()=>{
 const requests=[];
 const available=await checkForUpdate({currentVersion:'0.1.0',fetchImpl:async(url)=>{
  requests.push(url);return new Response(JSON.stringify(release),{status:200});
 }});
 assert.equal(available.version,'0.2.0');
 assert.deepEqual(requests,[API]);
});
test('checksum verifica EXE exato e rejeita ambiguidades',()=>{
 const sum='a'.repeat(64);
 assert.equal(parseSha256(sum+'  Loja-de-Roupas-Setup-x64.exe\n'),sum);
 assert.throws(()=>parseSha256('f'.repeat(64)+'  outro.exe\n'),/SHA256|checksum/i);
 assert.throws(()=>parseSha256(sum+'  Loja-de-Roupas-Setup-x64.exe\n'+sum+'  Loja-de-Roupas-Setup-x64.exe\n'),/duplicado|SHA256/i);
});
test('download somente após autorização explícita verifica hash e salva atomicamente',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'loja-update-'));
 const payload=Buffer.from('fake Windows installer');
 const digest=sha(payload);
 const calls=[];
 try{
  const saved=await downloadVerified({
   release:selectRelease({...release,assets:[{...release.assets[0],size:payload.length},release.assets[1]]},'0.1.0'),
   directory:root,
   fetchImpl:async url=>{calls.push(url);
    return new Response(url===HASH?digest+'  Loja-de-Roupas-Setup-x64.exe\n':payload,{status:200});}
  });
  assert.equal(sha(await readFile(saved)),digest);
  assert.deepEqual(calls,[HASH,RELEASE]);
  assert.equal((await readdir(root)).filter(x=>x.endsWith('.part')).length,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('arquivo com SHA256 incorreto nunca fica disponível para instalação',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'loja-update-invalid-'));
 try{
  await assert.rejects(()=>downloadVerified({
   release:selectRelease({...release,assets:[{...release.assets[0],size:Buffer.byteLength('tampered')},release.assets[1]]},'0.1.0'),directory:root,
   fetchImpl:async url=>new Response(url===HASH?'f'.repeat(64)+'  Loja-de-Roupas-Setup-x64.exe\n':Buffer.from('tampered'),{status:200})
  }),/SHA256|integridade/i);
  assert.deepEqual(await readdir(root),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('backup pré-update arquiva PostgreSQL, registra SHA e nunca usa rede remota',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'loja-updater-backup-'));
 const resources=path.join(root,'resources'),userData=path.join(root,'user-data');
 try{
  const binary=path.join(resources,'runtime','postgres','bin','pg_dump.exe');
  await mkdir(path.dirname(binary),{recursive:true});
  await mkdir(userData,{recursive:true});
  await writeFile(binary,'fixture executable');
  await writeFile(path.join(userData,'local-runtime.json'),JSON.stringify({pgPort:54299,password:'local-fake-secret'}));
  const calls=[];
  const report=await backupBeforeUpdate({resources,userData,runDump:async(file,args,env)=>{
   calls.push({file,args,host:args[args.indexOf('-h')+1],password:env.PGPASSWORD});
   await writeFile(args[args.indexOf('-f')+1],Buffer.from('PGDMP test consistent snapshot'));
  }});
  assert.equal(calls.length,1);
  assert.equal(calls[0].host,'127.0.0.1');
  assert.equal(calls[0].password,'local-fake-secret');
  assert.ok(report.file.includes(path.join('backups','before-update')));
  const data=await readFile(report.file);
  assert.equal(report.sha256,sha(data));
  assert.match(await readFile(report.file+'.sha256','utf8'),new RegExp(report.sha256));
  assert.equal((await readdir(path.dirname(report.file))).some(name=>name.endsWith('.part')),false);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('falha no backup interrompe atualização sem arquivos parciais',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'loja-updater-fail-'));
 const resources=path.join(root,'resources'),userData=path.join(root,'user-data');
 try{
  const binary=path.join(resources,'runtime','postgres','bin','pg_dump.exe');
  await mkdir(path.dirname(binary),{recursive:true});await mkdir(userData,{recursive:true});
  await writeFile(binary,'fixture executable');
  await writeFile(path.join(userData,'local-runtime.json'),JSON.stringify({pgPort:54299,password:'fake'}));
  await assert.rejects(()=>backupBeforeUpdate({resources,userData,runDump:async(_binary,args)=>{
   await writeFile(args[args.indexOf('-f')+1],'incomplete');
   throw new Error('PostgreSQL não disponível');
  }}),/PostgreSQL não disponível/);
  assert.deepEqual(await readdir(path.join(userData,'backups','before-update')),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('terminal LAN não tenta gerar backup de banco local inexistente',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'loja-remote-update-'));
 try{
  const backup=await backupBeforeUpdate({resources:path.join(root,'nothing'),userData:root,
   runDump:async()=>{throw new Error('Não deveria executar pg_dump');}});
  assert.equal(backup,null);
 }finally{await rm(root,{recursive:true,force:true});}
});
