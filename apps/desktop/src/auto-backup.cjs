'use strict';
const fs=require('node:fs/promises');
const {readFileSync}=require('node:fs');
const path=require('node:path');

/**
 * Agenda o backup automático do banco local. Confere a cada hora; grava quando o último backup
 * automático tem mais de 20 horas e guarda as 14 cópias mais recentes na pasta escolhida.
 */
function createAutoBackup({runtime,userData,defaultFolder,checkEveryMs=60*60_000,firstDelayMs=2*60_000,log=()=>{}}){
 const configFile=path.join(userData,'auto-backup.json');
 let config={enabled:true,folder:defaultFolder,last_success_at:null,last_file:null,last_error:null,last_attempt_at:null};
 try{config={...config,...JSON.parse(readFileSync(configFile,'utf8'))};}catch{}
 let timer=null,first=null,running=null;
 const save=async()=>{
  const temp=configFile+'.tmp';
  await fs.writeFile(temp,JSON.stringify(config,null,1),{mode:0o600});
  await fs.rename(temp,configFile);
 };
 async function run(force){
  if(running)return running;
  running=(async()=>{
   config.last_attempt_at=new Date().toISOString();
   try{
    const result=await runtime.autoBackup(config.folder,force);
    if(!result.skipped){config.last_success_at=new Date().toISOString();config.last_file=result.file;}
    config.last_error=null;
    await save();
    return {ok:true,...result};
   }catch(error){
    config.last_error=String(error?.message||error).slice(0,500);
    await save().catch(()=>{});
    log('Backup automático falhou: '+config.last_error);
    return {ok:false,error:config.last_error};
   }finally{running=null;}
  })();
  return running;
 }
 return {
  start(){
   if(!config.enabled||timer)return;
   first=setTimeout(()=>{void run(false);},firstDelayMs);
   timer=setInterval(()=>{void run(false);},checkEveryMs);
   first.unref?.();timer.unref?.();
  },
  stop(){if(first)clearTimeout(first);if(timer)clearInterval(timer);first=timer=null;},
  status(){
   const last=config.last_success_at?Date.parse(config.last_success_at):null;
   const ageHours=last?Math.floor((Date.now()-last)/3600_000):null;
   return {...config,age_hours:ageHours,overdue:ageHours===null||ageHours>=48};
  },
  async setFolder(folder){
   if(typeof folder!=='string'||!path.isAbsolute(folder))throw new Error('Pasta inválida.');
   const resolved=path.resolve(folder),data=path.resolve(userData);
   if(resolved===data||resolved.startsWith(path.join(data,'postgres-data')))
    throw new Error('Escolha uma pasta fora dos dados internos do programa.');
   config.folder=resolved;await save();
   return {folder:resolved};
  },
  runNow(){return run(true);}
 };
}
module.exports={createAutoBackup};
