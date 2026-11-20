'use strict';
// GitHub Releases is an optional update channel, not a runtime dependency.
// A check downloads JSON metadata only; installer bytes are fetched exclusively
// after a user clicks "Atualizar agora".
const {createHash,randomBytes}=require('node:crypto');
const {spawn}=require('node:child_process');
const {createReadStream}=require('node:fs');
const fs=require('node:fs/promises');
const path=require('node:path');

const API='https://api.github.com/repos/nutricionistaalmeidavh-spec/loja-roupas/releases/latest';
const ASSET='Loja-de-Roupas-Setup-x64.exe';
const MAX_INSTALLER=1_500_000_000;
const MAX_NOTES=4000;

function parts(version){
 const match=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
 if(!match)throw new Error('Formato de versão inválido');
 return match.slice(1).map(Number);
}
function compareVersions(a,b){
 const x=parts(a),y=parts(b);
 for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i]?1:-1;}
 return 0;
}
function safeAssetUrl(url,tag,name){
 const expected='https://github.com/nutricionistaalmeidavh-spec/loja-roupas/releases/download/'+encodeURIComponent(tag)+'/'+name;
 if(url!==expected)throw new Error('URL de atualização não pertence ao repositório oficial');
 return url;
}
function selectRelease(release,currentVersion){
 if(!release||release.draft||release.prerelease||!/^v?\d+\.\d+\.\d+$/.test(String(release.tag_name||'')))return null;
 if(compareVersions(release.tag_name,currentVersion)<=0)return null;
 const exe=release.assets?.find(a=>a.name===ASSET);
 const checksums=release.assets?.find(a=>a.name==='SHA256SUMS');
 if(!exe||!checksums)return null;
 if(!Number.isSafeInteger(exe.size)||exe.size<=0||exe.size>MAX_INSTALLER)return null;
 if(!Number.isSafeInteger(checksums.size)||checksums.size<=0||checksums.size>256*1024)return null;
 return {
  version:release.tag_name.replace(/^v/,''),notes:String(release.body||'').slice(0,MAX_NOTES),
  size:exe.size,
  assetUrl:safeAssetUrl(exe.browser_download_url,release.tag_name,ASSET),
  checksumUrl:safeAssetUrl(checksums.browser_download_url,release.tag_name,'SHA256SUMS')
 };
}
async function checkForUpdate({currentVersion,fetchImpl=fetch}){
 const response=await fetchImpl(API,{signal:AbortSignal.timeout(8000),headers:{
  Accept:'application/vnd.github+json','User-Agent':'Loja-de-Roupas-Desktop-Updater'
 }});
 if(response.status===404)return null; // Sem release oficial, sem atualização.
 if(!response.ok)throw new Error('GitHub indisponível (HTTP '+response.status+')');
 const release=await response.json();
 return selectRelease(release,currentVersion);
}
function parseSha256(manifest){
 if(typeof manifest!=='string'||manifest.length>256*1024)throw new Error('Manifesto SHA256 inválido');
 const records=manifest.split(/\r?\n/).map(l=>l.match(/^([a-fA-F0-9]{64}) [ *](.+)$/))
  .filter(Boolean).filter(m=>m[2]===ASSET);
 if(records.length!==1)throw new Error('Checksum SHA256 ausente ou duplicado');
 return records[0][1].toLowerCase();
}
async function checkedResponse(response,label){
 if(!response.ok)throw new Error(label+': HTTP '+response.status);
 if(!response.body)throw new Error(label+': resposta sem dados');
 return response;
}
async function getManifest(url,fetchImpl){
 const response=await checkedResponse(await fetchImpl(url,{signal:AbortSignal.timeout(20000)}),'Manifesto SHA256');
 const length=Number(response.headers.get('content-length')||0);
 if(length>256*1024)throw new Error('Manifesto SHA256 excessivo');
 let text='',bytes=0;
 for await(const part of response.body){bytes+=part.length;if(bytes>256*1024)throw new Error('Manifesto SHA256 excessivo');text+=Buffer.from(part).toString('utf8');}
 return parseSha256(text);
}
async function downloadVerified({release,directory,fetchImpl=fetch,onProgress=()=>{}}){
 const expected=await getManifest(release.checksumUrl,fetchImpl);
 const target=path.join(directory,'Loja-de-Roupas-Setup-x64-'+release.version+'.exe');
 const temp=target+'.'+randomBytes(6).toString('hex')+'.part';
 await fs.mkdir(directory,{recursive:true,mode:0o700});
 let handle,bytes=0;
 const hash=createHash('sha256');
 try{
  const response=await checkedResponse(await fetchImpl(release.assetUrl,{
   signal:AbortSignal.timeout(15*60*1000),headers:{'User-Agent':'Loja-de-Roupas-Desktop-Updater'}
  }),'Instalador');
  const size=Number(response.headers.get('content-length')||0);
  if(size>MAX_INSTALLER)throw new Error('Tamanho do instalador excede o limite seguro');
  handle=await fs.open(temp,'wx',0o600);
  for await(const part of response.body){
   const buffer=Buffer.from(part);bytes+=buffer.length;
   if(bytes>MAX_INSTALLER)throw new Error('Instalador excede limite seguro');
   hash.update(buffer);
   await handle.writeFile(buffer);
   onProgress({phase:'download',bytes,total:release.size});
  }
  await handle.sync();await handle.close();handle=null;
  if(bytes===0)throw new Error('Instalador vazio');
  if(bytes!==release.size)throw new Error('Tamanho do instalador diverge do GitHub');
  if(hash.digest('hex')!==expected)throw new Error('SHA256 divergente: instalação bloqueada por integridade');
  await fs.rm(target,{force:true});await fs.rename(temp,target);
  onProgress({phase:'verified',bytes,total:release.size});
  return target;
 }catch(error){
  if(handle)await handle.close().catch(()=>{});
  await fs.rm(temp,{force:true}).catch(()=>{});
  throw error;
 }
}
async function sha256(file){
 const hash=createHash('sha256');
 for await(const part of createReadStream(file))hash.update(part);
 return hash.digest('hex');
}
async function pgDump(binary,args,env){
 await new Promise((resolve,reject)=>{
  const child=spawn(binary,args,{windowsHide:true,env,stdio:['ignore','ignore','pipe']});
  let diagnostic='';
  child.stderr.on('data',data=>{diagnostic=(diagnostic+data.toString()).slice(-800);});
  child.once('error',reject);
  child.once('exit',code=>code===0?resolve():reject(new Error('Backup PostgreSQL falhou (código '+code+'): '+diagnostic.replace(/postgres(?:ql)?:\/\/\S+/gi,'[URL redigida]'))));
 });
}
async function backupBeforeUpdate({resources,userData,onProgress=()=>{}}){
 const configFile=path.join(userData,'local-runtime.json');
 let config;
 try{config=JSON.parse(await fs.readFile(configFile,'utf8'));}
 catch(error){if(error.code==='ENOENT')return null;throw new Error('Configuração PostgreSQL inválida; atualização cancelada');}
 if(!Number.isInteger(config.pgPort)||config.pgPort<1||config.pgPort>65535||typeof config.password!=='string'||!config.password)
  throw new Error('Configuração PostgreSQL incompleta; atualização cancelada');
 const binary=path.join(resources,'runtime','postgres','bin','pg_dump.exe');
 await fs.access(binary);
 const backupDir=path.join(userData,'backups','before-update');
 await fs.mkdir(backupDir,{recursive:true,mode:0o700});
 const name='loja-pre-update-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(4).toString('hex');
 const temp=path.join(backupDir,name+'.part');
 const final=path.join(backupDir,name+'.dump');
 onProgress({phase:'backup'});
 try{
  await pgDump(binary,['-h','127.0.0.1','-p',String(config.pgPort),'-U','postgres','-d','loja','-Fc','-f',temp],
   {...process.env,PGPASSWORD:config.password,PGCONNECT_TIMEOUT:'10'});
  const stat=await fs.stat(temp);
  if(!stat.size)throw new Error('Backup PostgreSQL vazio');
  const digest=await sha256(temp);
  await fs.rename(temp,final);
  await fs.writeFile(final+'.sha256',digest+'  '+path.basename(final)+'\n',{mode:0o600});
  onProgress({phase:'backup-complete'});
  return {file:final,sha256:digest};
 }catch(error){await fs.rm(temp,{force:true}).catch(()=>{});throw error;}
}
module.exports={compareVersions,selectRelease,checkForUpdate,parseSha256,downloadVerified,backupBeforeUpdate,sha256,API,ASSET};
