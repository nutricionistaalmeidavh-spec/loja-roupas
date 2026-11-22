'use strict';
const {createHash,randomBytes}=require('node:crypto');
const fs=require('node:fs/promises'),{createReadStream}=require('node:fs');
const path=require('node:path');
function backupFilename(date=new Date()){
 if(!(date instanceof Date)||!Number.isFinite(date.getTime()))throw Error('Data inválida');
 return 'loja-'+date.toISOString().replace(/[-:]/g,'').replace(/^(.{4})(.{2})(.{2})T(.{2})(.{2})(.{2}).*$/,'$1-$2-$3-$4$5$6')+'.dump';
}
function backupDestinationAllowed(destination,userData){
 if(typeof destination!=='string'||!path.isAbsolute(destination)||path.extname(destination).toLowerCase()!=='.dump')return false;
 const root=path.resolve(userData),target=path.resolve(destination);
 const rel=path.relative(root,target);
 if(rel==='local-runtime.json'||rel==='commercial-license.json')return false;
 if(rel==='postgres-data'||rel.startsWith('postgres-data'+path.sep)||rel==='sync-secrets'||rel.startsWith('sync-secrets'+path.sep))return false;
 return true;
}
async function writeBackup({destination,userData,executeDump}){
 if(!backupDestinationAllowed(destination,userData))throw Error('Destino de backup inválido ou protegido.');
 if(typeof executeDump!=='function')throw Error('Executador PostgreSQL ausente.');
 const folder=path.dirname(destination),part=destination+'.partial-'+randomBytes(6).toString('hex');
 await fs.mkdir(folder,{recursive:true});
 try{
  try{await fs.stat(destination);throw Error('Backup já existe. Escolha outro nome.');}
  catch(e){if(e.code!=='ENOENT')throw e;}
  await executeDump(part);
  const stat=await fs.stat(part);
  if(!stat.isFile()||stat.size<100)throw Error('Backup do banco vazio ou incompleto.');
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(part))hash.update(chunk);
  await fs.rename(part,destination);
  return {file:destination,bytes:stat.size,sha256:hash.digest('hex')};
 }finally{await fs.rm(part,{force:true}).catch(()=>{});}
}
module.exports={backupFilename,backupDestinationAllowed,writeBackup};
