const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,readFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {createCommercialLicense,validActivation,activeOffline}=require('../src/commercial-license.cjs');

test('código comercial pertence apenas à Loja Roupas, sem bloquear o core livre',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'loja-license-'));
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url:String(url),method:options?.method,body:options?.body});
  if(String(url).includes('/v1/activation/verify'))return Response.json({
   accountEmail:'teste@example.com',product:'LOJA_ROUPAS',licenseId:'license-1234',expiresAt:null
  });
  return Response.json({active:true,product:'LOJA_ROUPAS',expiresAt:null});
 };
 try{
  assert.deepEqual(validActivation({email:'Teste@Example.com',code:'123456'}),{email:'teste@example.com',code:'123456'});
  assert.throws(()=>validActivation({email:'x',code:'123456'}));
  const license=createCommercialLicense({directory:dir,fetchImpl});
  const first=await license.status();
  assert.equal(first.active,false);
  assert.match(first.installationId,/^loja-[a-f0-9-]+$/);
  const active=await license.activate({email:'Teste@Example.com',code:'123456'});
  assert.equal(active.active,true);
  assert.match(calls[0].body,/"product":"LOJA_ROUPAS"/);
  assert.equal((await license.status()).active,true);
  const contents=JSON.parse(await readFile(path.join(dir,'commercial-license.json'),'utf8'));
  assert.equal(contents.code,undefined,'nunca persistir código de ativação');
  assert.equal(contents.accountEmail,'teste@example.com');
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('bloqueio remoto explícito não é confundido com queda de internet',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'loja-lic-revoke-'));
 let revoked=false;
 const fetchImpl=async(url)=>{
  if(String(url).includes('/verify'))return Response.json({accountEmail:'ok@example.com',product:'LOJA_ROUPAS',licenseId:'license-1',expiresAt:null});
  if(revoked)return Response.json({active:false,product:'LOJA_ROUPAS',expiresAt:null});
  return Response.json({active:true,product:'LOJA_ROUPAS',expiresAt:null});
 };
 try{
  const a=createCommercialLicense({directory:dir,fetchImpl});
  await a.activate({email:'ok@example.com',code:'123456'});
  revoked=true;
  assert.equal((await a.status({refresh:true})).active,false);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('rede offline preserva licença já válida sem criar licença nova',()=>{
 const now=Date.now();
 assert.equal(activeOffline({active:true,licenseId:'lic-1',expiresAt:null},now),true);
 assert.equal(activeOffline({active:false,licenseId:'lic-1',expiresAt:null},now),false);
 assert.equal(activeOffline({active:true,licenseId:'lic-1',expiresAt:new Date(now-1000).toISOString()},now),false);
});
