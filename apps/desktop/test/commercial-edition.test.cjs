const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const {mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {checkForUpdate,parseSha256}=require('../src/updates.cjs');
const {createCommercialLicense,withinOfflineGrace,OFFLINE_GRACE_MS}=require('../src/commercial-license.cjs');
const root='https://github.com/nutricionistaalmeidavh-spec/loja-roupas/releases/download/';
const repo=path.resolve(__dirname,'../../..');
const release=(tag,asset,options={})=>({tag_name:tag,draft:false,prerelease:true,body:'',assets:[
 {name:asset,size:18,browser_download_url:root+tag+'/'+asset},
 {name:'SHA256SUMS',size:120,browser_download_url:root+tag+'/SHA256SUMS'}
],...options});
const fetchList=list=>async()=>new Response(JSON.stringify(list),{status:200});

test('edição comercial só recebe atualização do canal comercial',async()=>{
 const list=[release('loja-fisica-v9.0.0','Loja-de-Roupas-Fisica-Setup-x64.exe'),
  release('loja-comercial-v1.0.1','Loja-de-Roupas-Comercial-Setup-x64.exe',{prerelease:false})];
 const selected=await checkForUpdate({currentVersion:'1.0.0',commercialEdition:true,fetchImpl:fetchList(list)});
 assert.equal(selected.version,'1.0.1');
 assert.equal(selected.assetName,'Loja-de-Roupas-Comercial-Setup-x64.exe');
 assert.equal(await checkForUpdate({currentVersion:'1.0.0',commercialEdition:true,
  fetchImpl:fetchList([list[0]])}),null,'instalador livre nunca substitui o comercial');
});
test('edição física livre ignora o canal comercial',async()=>{
 const list=[release('loja-comercial-v9.0.0','Loja-de-Roupas-Comercial-Setup-x64.exe')];
 assert.equal(await checkForUpdate({currentVersion:'0.2.7',physicalEdition:true,fetchImpl:fetchList(list)}),null);
});
test('checksum comercial aceita somente o instalador comercial',()=>{
 const sum='a'.repeat(64);
 assert.equal(parseSha256(sum+'  Loja-de-Roupas-Comercial-Setup-x64.exe\n','Loja-de-Roupas-Comercial-Setup-x64.exe'),sum);
 assert.throws(()=>parseSha256(sum+'  Loja-de-Roupas-Fisica-Setup-x64.exe\n','Loja-de-Roupas-Comercial-Setup-x64.exe'));
});
test('licença ativa funciona offline por até 30 dias e depois pede internet',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'loja-grace-'));
 let now=Date.parse('2026-12-01T12:00:00Z'),online=true;
 const fetchImpl=async url=>{
  if(!online)throw new TypeError('fetch failed');
  if(String(url).includes('/verify'))return Response.json({accountEmail:'a@example.com',product:'LOJA_ROUPAS',licenseId:'lic-1',expiresAt:null});
  return Response.json({active:true,product:'LOJA_ROUPAS',expiresAt:null});
 };
 try{
  const license=createCommercialLicense({directory:dir,fetchImpl,clock:()=>now});
  await license.activate({email:'a@example.com',code:'123456'});
  online=false;
  now+=OFFLINE_GRACE_MS-60_000;
  let state=await license.status({refresh:true});
  assert.equal(state.active,true);assert.equal(state.offline,true);assert.equal(state.needsOnline,false);
  now+=120_000;
  state=await license.status({refresh:true});
  assert.equal(state.active,false);assert.equal(state.needsOnline,true);
  online=true;
  state=await license.status({refresh:true});
  assert.equal(state.active,true,'revalidação online libera de novo');assert.equal(state.needsOnline,false);
 }finally{await rm(dir,{recursive:true,force:true})}
 assert.equal(withinOfflineGrace({checkedAt:0},Date.now()),false);
});
test('empacotador e instalador comercial são separados da edição física',()=>{
 const pack=readFileSync(path.join(repo,'scripts/package-desktop.mjs'),'utf8');
 assert.match(pack,/commercialEdition\|\|process\.env\.LOJA_PHYSICAL_EDITION/);
 assert.match(pack,/edition:'commercial'/);
 const nsi=readFileSync(path.join(repo,'infra/desktop/loja-roupas-comercial.nsi'),'utf8');
 assert.match(nsi,/Loja-de-Roupas-Comercial-Setup-x64\.exe/);
 assert.match(nsi,/Programs\\Loja de Roupas Comercial/);
 assert.match(nsi,/MUI_PAGE_LICENSE .*termos-de-uso\.txt/);
 assert.doesNotMatch(nsi,/Loja de Roupas Fisica/);
 const main=readFileSync(path.join(repo,'apps/desktop/src/main.cjs'),'utf8');
 assert.match(main,/commercialEdition\?'loja-roupas-comercial':'loja-roupas-fisica'/);
 assert.match(main,/createDesktopUpdater\(\{[^}]*commercialEdition\}\)/);
});
