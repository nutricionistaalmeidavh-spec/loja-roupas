const test=require('node:test');
const assert=require('node:assert/strict');
const {selectPhysicalRelease,checkForUpdate,parseSha256,downloadVerified}=require('../src/updates.cjs');
const {createHash}=require('node:crypto');
const {mkdtemp,readFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const root='https://github.com/nutricionistaalmeidavh-spec/loja-roupas/releases/download/';
const mk=(v,options={})=>{
 const tag='loja-fisica-v'+v;
 return {tag_name:tag,draft:false,prerelease:true,body:'Edição física',assets:[
  {name:'Loja-de-Roupas-Fisica-Setup-x64.exe',size:18,browser_download_url:root+tag+'/Loja-de-Roupas-Fisica-Setup-x64.exe'},
  {name:'SHA256SUMS',size:120,browser_download_url:root+tag+'/SHA256SUMS'}
 ],...options};
};
test('edição física escolhe somente a versão nova aprovada, não a versão geral',()=>{
 const selected=selectPhysicalRelease([mk('0.2.4'),mk('0.2.5',{draft:true}),mk('0.3.0',{prerelease:false}),
  {...mk('0.2.6'),tag_name:'v0.2.6'},mk('0.2.3')],'0.2.3');
 assert.equal(selected.version,'0.2.4');
 assert.equal(selected.assetName,'Loja-de-Roupas-Fisica-Setup-x64.exe');
 assert.equal(selectPhysicalRelease([mk('0.2.2')],'0.2.3'),null);
 assert.equal(selectPhysicalRelease([mk('0.2.4',{assets:[{name:'SHA256SUMS',size:120,browser_download_url:root+'loja-fisica-v0.2.4/SHA256SUMS'}]})],'0.2.3'),null);
 assert.throws(()=>selectPhysicalRelease([mk('0.2.4',{assets:[{...mk('0.2.4').assets[0],browser_download_url:'https://evil.example/a.exe'},mk('0.2.4').assets[1]]})],'0.2.3'),/URL|origem/i);
});
test('consulta física usa apenas metadados públicos, não baixa o EXE',async()=>{
 const visited=[];
 const selected=await checkForUpdate({currentVersion:'0.2.3',physicalEdition:true,fetchImpl:async(url)=>{
  visited.push(url);return new Response(JSON.stringify([mk('0.2.4')]),{status:200});
 }});
 assert.equal(selected.version,'0.2.4');
 assert.deepEqual(visited,['https://api.github.com/repos/nutricionistaalmeidavh-spec/loja-roupas/releases?per_page=40']);
});
test('checksum da edição física valida o nome específico, sem reutilizar checksum do canal geral',()=>{
 const sum='1'.repeat(64);
 assert.equal(parseSha256(sum+'  Loja-de-Roupas-Fisica-Setup-x64.exe\n','Loja-de-Roupas-Fisica-Setup-x64.exe'),sum);
 assert.throws(()=>parseSha256(sum+'  Loja-de-Roupas-Setup-x64.exe\n','Loja-de-Roupas-Fisica-Setup-x64.exe'),/checksum|SHA256/i);
});
test('download físico não aceita payload adulterado',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'loja-fisica-'));
 const payload=Buffer.from('physical payload!');
 const release=selectPhysicalRelease([mk('0.2.4',{assets:[
  {...mk('0.2.4').assets[0],size:payload.length},
  mk('0.2.4').assets[1]
 ]})],'0.2.3');
 const digest=createHash('sha256').update(payload).digest('hex');
 try{
  const filepath=await downloadVerified({release,directory:folder,fetchImpl:async url=>
   new Response(url.endsWith('SHA256SUMS')?digest+'  Loja-de-Roupas-Fisica-Setup-x64.exe\n':payload,{status:200})});
  assert.match(filepath,/Fisica/);
  assert.deepEqual(await readFile(filepath),payload);
 }finally{await rm(folder,{recursive:true,force:true});}
});
