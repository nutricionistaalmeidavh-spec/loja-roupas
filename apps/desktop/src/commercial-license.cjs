'use strict';
const {randomUUID}=require('node:crypto');
const {readFile,writeFile,rename,mkdir,rm}=require('node:fs/promises');
const path=require('node:path');
const ENDPOINT='https://pdv-artisys.sistema-artisys.workers.dev';
const PRODUCT='LOJA_ROUPAS';
const REFRESH_MS=15*60*1000;

function validActivation(value){
 const email=String(value?.email||'').trim().toLowerCase();
 const code=String(value?.code||'');
 if(email.length>254||!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(email))throw Error('E-mail de licença inválido.');
 if(!/^\d{6}$/.test(code))throw Error('O código de ativação deve ter seis dígitos.');
 return {email,code};
}
function activeOffline(record,at=Date.now()){
 return Boolean(record?.active&&record?.licenseId&&(!record.expiresAt||
  Number.isFinite(Date.parse(record.expiresAt))&&Date.parse(record.expiresAt)>at));
}
function validateRecord(v){
 if(!/^loja-[a-f0-9-]{36}$/.test(v?.installationId)||typeof v?.active!=='boolean'||
   (v.licenseId!==null&&typeof v.licenseId!=='string')||
   (v.expiresAt!==null&&(!Number.isFinite(Date.parse(v.expiresAt)))))
  throw Error('Arquivo comercial inválido; preserve-o para recuperação.');
 return v;
}
function createCommercialLicense({directory,fetchImpl=fetch,clock=Date.now}={}){
 if(!directory)throw Error('Diretório de dados da instalação obrigatório.');
 const file=path.join(directory,'commercial-license.json');
 let statePromise;
 async function save(value){
  const temporary=file+'.'+randomUUID()+'.tmp';
  await mkdir(directory,{recursive:true,mode:0o700});
  try{
   await writeFile(temporary,JSON.stringify(value),{mode:0o600,flag:'wx'});
   await rename(temporary,file);
  }finally{await rm(temporary,{force:true}).catch(()=>{});}
  return value;
 }
 async function load(){
  try{return validateRecord(JSON.parse(await readFile(file,'utf8')));}
  catch(error){
   if(error.code!=='ENOENT')throw error;
   return save({installationId:'loja-'+randomUUID(),licenseId:null,accountEmail:null,
    active:false,expiresAt:null,checkedAt:0});
  }
 }
 const get=()=>statePromise??=(load());
 function view(state,{offline=false}={}){
  return {installationId:state.installationId,active:activeOffline(state,clock()),
   accountEmail:state.accountEmail||null,expiresAt:state.expiresAt||null,offline};
 }
 async function call(route,options={}){
  let response;
  try{response=await fetchImpl(ENDPOINT+route,{
   redirect:'manual',signal:AbortSignal.timeout(6000),...options
  });}catch(error){throw Object.assign(Error('Central indisponível'),{offline:true,cause:error});}
  if(!response.ok)throw Object.assign(Error('Central recusou a solicitação ('+response.status+').'),{
   status:response.status,offline:response.status>=500||response.status===429
  });
  return response.json();
 }
 async function status({refresh=false}={}){
  const state=await get();
  if(!activeOffline(state,clock()))return view(state);
  if(!refresh&&Number.isFinite(state.checkedAt)&&clock()-state.checkedAt<REFRESH_MS)return view(state);
  try{
   const q=new URLSearchParams({installationId:state.installationId,product:PRODUCT});
   const response=await call('/v1/license/status?'+q);
   if(response.product!==PRODUCT||typeof response.active!=='boolean')throw Error('Resposta de licença incompatível.');
   const next={...state,active:response.active,expiresAt:response.expiresAt||null,checkedAt:clock()};
   statePromise=Promise.resolve(await save(next));
   return view(next);
  }catch(error){
   if(error.offline)return view(state,{offline:true});
   const revoked={...state,active:false,checkedAt:clock()};
   statePromise=Promise.resolve(await save(revoked));
   return view(revoked);
  }
 }
 async function activate(payload){
  const {email,code}=validActivation(payload);
  const state=await get();
  const data=await call('/v1/activation/verify',{method:'POST',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({email,code,product:PRODUCT,installationId:state.installationId})
  });
  if(data.product!==PRODUCT||String(data.accountEmail||'').toLowerCase()!==email||
   typeof data.licenseId!=='string'||data.licenseId.length<3||
   (data.expiresAt&&!Number.isFinite(Date.parse(data.expiresAt))))
    throw Error('A central retornou uma licença de outro produto ou inválida.');
  const next={...state,active:true,accountEmail:email,
   licenseId:data.licenseId,expiresAt:data.expiresAt||null,checkedAt:clock()};
  statePromise=Promise.resolve(await save(next));
  return view(next);
 }
 return Object.freeze({status,activate});
}
module.exports={createCommercialLicense,validActivation,activeOffline};
