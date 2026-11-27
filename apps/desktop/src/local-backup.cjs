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
async function isPgDumpArchive(file){
 if(typeof file!=='string'||path.extname(file).toLowerCase()!=='.dump')return false;
 let handle;
 try{
  handle=await fs.open(file,'r');
  const sig=Buffer.alloc(5),result=await handle.read(sig,0,5,0);
  return result.bytesRead===5&&sig.toString('ascii')==='PGDMP';
 }catch{return false;}finally{await handle?.close().catch(()=>{});}
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
const AUTO_PREFIX='loja-auto-';
/** Decide se o backup automático está vencido e quais cópias antigas apagar. Função pura, sem disco. */
function autoBackupPlan({files,now=new Date(),intervalHours=20,keep=14}){
 const autos=files.filter(f=>f.name.startsWith(AUTO_PREFIX)&&f.name.endsWith('.dump'))
  .sort((a,b)=>b.mtimeMs-a.mtimeMs);
 const newest=autos[0];
 const due=!newest||now.getTime()-newest.mtimeMs>=intervalHours*3600_000;
 const keepAfter=due?keep-1:keep;
 return {due,remove:autos.slice(Math.max(0,keepAfter)).map(f=>f.name),last:newest?newest.name:null};
}
/** Backup automático numa pasta fixa, mantendo as últimas N cópias. */
async function runAutoBackup({folder,userData,executeDump,now=new Date(),intervalHours=20,keep=14,force=false}){
 if(typeof folder!=='string'||!path.isAbsolute(folder))throw Error('Pasta de backup automático inválida.');
 await fs.mkdir(folder,{recursive:true});
 const names=await fs.readdir(folder);
 const files=[];
 for(const name of names){
  if(!name.startsWith(AUTO_PREFIX))continue;
  const stat=await fs.stat(path.join(folder,name)).catch(()=>null);
  if(stat?.isFile())files.push({name,mtimeMs:stat.mtimeMs});
 }
 const plan=autoBackupPlan({files,now,intervalHours,keep});
 if(!plan.due&&!force)return {skipped:true,last:plan.last};
 const destination=path.join(folder,AUTO_PREFIX+backupFilename(now).slice('loja-'.length));
 const saved=await writeBackup({destination,userData,executeDump});
 const removePlan=autoBackupPlan({files,now,intervalHours,keep}).remove;
 for(const name of removePlan)await fs.rm(path.join(folder,name),{force:true}).catch(()=>{});
 return {skipped:false,...saved,removed:removePlan};
}
module.exports={backupFilename,backupDestinationAllowed,writeBackup,isPgDumpArchive,autoBackupPlan,runAutoBackup,AUTO_PREFIX};
