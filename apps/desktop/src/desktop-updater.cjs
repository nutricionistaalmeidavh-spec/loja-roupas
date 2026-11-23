'use strict';
const {spawn}=require('node:child_process');
const {existsSync}=require('node:fs');
const fs=require('node:fs/promises');
const path=require('node:path');
const {checkForUpdate,downloadVerified,backupBeforeUpdate,sha256}=require('./updates.cjs');

function createDesktopUpdater({app,ipcMain,BrowserWindow,dialog,physicalEdition=false}){
 let available=null,busy=false,lastProgress={phase:'idle'};
 const installedRoot=path.dirname(path.dirname(process.execPath));
 const installSupported=process.platform==='win32'&&
  existsSync(path.join(installedRoot,'Uninstall.exe'))&&
  path.basename(path.dirname(process.execPath)).toLowerCase()==='app';
 const clients=new Map();
 function emit(progress){
  lastProgress=progress;
  for(const [contents,origin] of clients){
   if(contents.isDestroyed()){clients.delete(contents);continue;}
   try{if(new URL(contents.getURL()).origin===origin)contents.send('loja:updates:progress',progress);}
   catch{}
  }
 }
 function registerWindow(window,origin){
  const contents=window.webContents;
  clients.set(contents,new URL(origin).origin);
  // The BrowserWindow is already destroyed when 'closed' fires; never
  // dereference native webContents from that callback.
  window.once('closed',()=>clients.delete(contents));
 }
 function allowed(event){
  const origin=clients.get(event.sender);
  if(!origin)throw new Error('Canal de atualização indisponível nesta janela');
  try{if(new URL(event.sender.getURL()).origin!==origin)throw new Error('Origem alterada');}
  catch{throw new Error('Origem não autorizada para atualizações');}
 }
 async function check(){
  if(!installSupported)return {supported:false,currentVersion:app.getVersion(),available:null,
   message:'Atualizador disponível no instalador Windows. No navegador e na edição portátil, consulte o administrador.'};
  try{
   available=await checkForUpdate({currentVersion:app.getVersion(),physicalEdition});
   return {supported:true,currentVersion:app.getVersion(),available};
  }catch(error){
   available=null;
   return {supported:true,currentVersion:app.getVersion(),available:null,
    message:'Não foi possível consultar o GitHub. O aplicativo continua funcionando offline.'};
  }
 }
 async function lastResult(){
  try{
   const raw=await fs.readFile(path.join(app.getPath('userData'),'updates','last-result.json'),'utf8');
   const parsed=JSON.parse(raw.replace(/^\uFEFF/,''));
   return {status:parsed.status,message:String(parsed.message||'').slice(0,800)};
  }catch{return null;}
 }
 async function install(event){
  if(!installSupported)throw new Error('Instalador de atualizações indisponível neste ambiente');
  if(busy)throw new Error('Atualização já em andamento');
  // The trusted native confirmation is independent of any renderer: web content
  // cannot initiate a download without the user approving the native dialog.
  const owner=BrowserWindow.fromWebContents(event.sender);
  const answer=await dialog.showMessageBox(owner,{
   type:'question',buttons:['Cancelar','Baixar e instalar'],defaultId:0,cancelId:0,noLink:true,
   title:'Atualização da Loja de Roupas',
   message:'Baixar e instalar a atualização oficial?',
   detail:'O programa fará backup do PostgreSQL local antes de instalar e preservará uma cópia da versão anterior. Nenhum arquivo será baixado se você cancelar.'
  });
  if(answer.response!==1)return {started:false,cancelled:true};
  busy=true;
  let resultFilePath=null;
  let helperLaunched=false;
  try{
   // Revalidate release at the actual moment of user consent.
   available=await checkForUpdate({currentVersion:app.getVersion(),physicalEdition});
   if(!available)throw new Error('Não há nova versão estável disponível com checksum SHA256');
   const userData=app.getPath('userData');
   const dir=path.join(userData,'updates');
   emit({phase:'preparing',version:available.version});
   const installer=await downloadVerified({release:available,directory:dir,onProgress:emit});
   emit({phase:'checking-integrity',version:available.version});
   const expectedHash=await sha256(installer);
   const backup=await backupBeforeUpdate({resources:process.resourcesPath,userData,onProgress:emit});
   const version=available.version;
   const timestamp=new Date().toISOString().replace(/[:.]/g,'-');
   const rollback=path.join(dir,'rollback-'+app.getVersion()+'-'+timestamp);
   const script=path.join(dir,'upgrade-helper-'+version+'.ps1');
   const resultFile=path.join(dir,'last-result.json');
   resultFilePath=resultFile;
   await fs.copyFile(path.join(__dirname,'update-helper.ps1'),script);
   // Store a durable marker before quitting. If the detached helper is blocked
   // or never starts, the next launch can explain the incomplete attempt.
   await fs.writeFile(resultFile,JSON.stringify({
    status:'pending',version,message:'Aguardando o instalador concluir a atualização.',
    updated_at:new Date().toISOString()
   }),{encoding:'utf8',mode:0o600});
   // PowerShell is built into Windows. It remains running after Electron exits,
   // when the API and PostgreSQL are already stopped by the existing quit flow.
   const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
    '-File',script,'-ParentPid',String(process.pid),'-Installer',installer,
    '-ExpectedSha256',expectedHash,'-ExpectedVersion',version,'-InstallDir',installedRoot,
    '-RollbackDir',rollback,'-ResultFile',resultFile];
   const child=spawn('powershell.exe',args,{detached:true,stdio:'ignore',windowsHide:true});
   await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
   child.unref();
   helperLaunched=true;
   emit({phase:'installing',version,backupCreated:Boolean(backup)});
   setTimeout(()=>app.quit(),400);
   return {started:true,backupCreated:Boolean(backup)};
  }catch(error){
   const message=error instanceof Error?error.message:'Falha ao preparar atualização';
   if(resultFilePath&&!helperLaunched){
    await fs.writeFile(resultFilePath,JSON.stringify({
     status:'failed',message,updated_at:new Date().toISOString()
    }),{encoding:'utf8',mode:0o600}).catch(()=>{});
   }
   emit({phase:'error',message});
   throw error;
  }finally{busy=false;}
 }
 ipcMain.handle('loja:updates:info',event=>{allowed(event);return {supported:installSupported,currentVersion:app.getVersion()};});
 ipcMain.handle('loja:updates:check',async event=>{allowed(event);return check();});
 ipcMain.handle('loja:updates:last-result',async event=>{allowed(event);return lastResult();});
 ipcMain.handle('loja:updates:install',async event=>{allowed(event);return install(event);});
 return {registerWindow};
}
module.exports={createDesktopUpdater};
