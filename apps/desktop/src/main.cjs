const {app,BrowserWindow,dialog,shell,ipcMain}=require('electron');
const {readFileSync} =require('node:fs');
const fs=require('node:fs/promises');
const path=require('node:path');
const {launchLocalRuntime}=require('./local-runtime.cjs');
const {existsSync}=require('node:fs');
const {createCommercialLicense}=require('./commercial-license.cjs');

let runtime=null,setupWindow=null,setupState={status:'Preparando sua loja…',ready:false,error:''};
const commercialEdition=existsSync(path.join(__dirname,'commercial-edition.json'));
let commercialLicense=null;
let quitting=false;
const single=app.requestSingleInstanceLock();
if(!single)app.quit();
app.on('second-instance',()=>{
 const win=BrowserWindow.getAllWindows()[0];
 if(win){if(win.isMinimized())win.restore();win.focus();}
});

function validateOrigin(value){
 const url=new URL(value);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'
  ||url.search||url.hash)throw new Error('Informe apenas o endereço HTTP/HTTPS da loja, com porta se necessário.');
 return url;
}
function configuredUrl(){
 let configured=process.env.LOJA_SERVER_URL;
 if(!configured){
  try{configured=readFileSync(path.join(app.getPath('userData'),'server-url.txt'),'utf8').trim();}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
 return configured?validateOrigin(configured):null;
}
function openWindow(url){
 const window=new BrowserWindow({
  width:1440,height:900,minWidth:760,minHeight:560,
  webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}
 });
 window.webContents.setWindowOpenHandler(({url:target})=>{
  try{
   const next=new URL(target);
   if(next.origin===url.origin&&/^\/vitrine\/[0-9a-f-]{36}$/i.test(next.pathname)
      &&!next.username&&!next.password&&!next.search&&!next.hash){
    void shell.openExternal(next.href).catch(error=>dialog.showErrorBox('Abrir vitrine',error.message));
   }
  }catch{}
  return {action:'deny'};
 });
 for(const name of ['will-navigate','will-redirect']){
  window.webContents.on(name,(event,target)=>{
   try{if(new URL(target).origin!==url.origin)event.preventDefault();}
   catch{event.preventDefault();}
  });
 }
 void window.loadURL(url.href).catch(error=>dialog.showErrorBox('Conexão com a loja',error.message));
 return window;
}
function status(message){
 setupState={...setupState,status:message};
 if(setupWindow&&!setupWindow.isDestroyed())setupWindow.webContents.send('loja:setup-status',setupState);
}
function showError(error){
 setupState={...setupState,error:error instanceof Error?error.message:'Falha ao iniciar os componentes locais'};
 status('Instalação local não iniciada');
}
function setupAllowed(event){
 if(!setupWindow||event.sender!==setupWindow.webContents||
  !event.sender.getURL().startsWith('file://'))throw new Error('Operação não permitida fora do assistente local.');
}
function transition(url){
 openWindow(url);
 if(setupWindow&&!setupWindow.isDestroyed())setupWindow.close();
 setupWindow=null;
}
async function requireCommercialApproval(){
 if(!commercialEdition)return true;
 commercialLicense??=createCommercialLicense({directory:app.getPath('userData')});
 const state=await commercialLicense.status({refresh:true});
 if(state.active)return true;
 setupState={status:'Informe o código enviado pela ArtiSys depois da liberação na Central.',
  activationRequired:true,installationId:state.installationId,ready:false,error:''};
 status(setupState.status);
 return false;
}
async function beginLocal(){
 try{if(await requireCommercialApproval())await startLocal();}
 catch(error){showError(error);}
}
async function startLocal(){
 setupState={status:'Preparando PostgreSQL e interface local…',ready:false,error:''};
 status(setupState.status);
 try{
  runtime=await launchLocalRuntime({resources:process.resourcesPath,
   userData:app.getPath('userData'),exe:process.execPath,progress:status});
  if(!runtime.firstRun){transition(validateOrigin(runtime.url));return;}
  setupState={status:'Banco e API prontos. Cadastre o administrador.',ready:true,error:''};
  status(setupState.status);
 }catch(error){showError(error);}
}
function registerSetupHandlers(){
 ipcMain.handle('loja:setup-state',event=>{setupAllowed(event);return setupState;});
 ipcMain.handle('loja:setup-activate',async(event,input)=>{
  setupAllowed(event);
  if(!commercialEdition)throw new Error('Ativação comercial indisponível na edição livre.');
  if(!setupState.activationRequired)throw new Error('A ativação não está sendo solicitada.');
  commercialLicense??=createCommercialLicense({directory:app.getPath('userData')});
  const license=await commercialLicense.activate(input);
  if(!license.active)throw new Error('Licença não autorizada.');
  await startLocal();
  return {ok:true};
 });
 ipcMain.handle('loja:setup-create',async(event,input)=>{
  setupAllowed(event);
  if(!runtime||!setupState.ready)throw new Error('O banco ainda não está pronto.');
  const result=await runtime.bootstrap(input);
  transition(validateOrigin(runtime.url));
  return result;
 });
 ipcMain.handle('loja:setup-remote',async(event,raw)=>{
  setupAllowed(event);
  const url=validateOrigin(String(raw||''));
  const response=await fetch(url.href+'v1/ready',{signal:AbortSignal.timeout(4000)});
  if(!response.ok)throw new Error('A loja indicada não respondeu. Verifique endereço e rede LAN.');
  const target=path.join(app.getPath('userData'),'server-url.txt');
  await fs.writeFile(target,url.href,{encoding:'utf8',mode:0o600});
  if(runtime){await runtime.stop();runtime=null;}
  transition(url);
  return {ok:true};
 });
 ipcMain.handle('loja:setup-retry',async(event)=>{
  setupAllowed(event);if(runtime)await runtime.stop();runtime=null;
  void beginLocal();return {ok:true};
 });
}
async function start(){
 if(!single)return;
 const url=configuredUrl();
 if(url){openWindow(url);return;}
 if(process.platform!=='win32'){openWindow(validateOrigin('http://127.0.0.1:'+(process.defaultApp?'5173':'8080')));return;}
 registerSetupHandlers();
 setupWindow=new BrowserWindow({width:670,height:820,minWidth:530,minHeight:670,
  webPreferences:{preload:path.join(__dirname,'setup-preload.cjs'),
   contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
 await setupWindow.loadFile(path.join(__dirname,'setup.html'));
 await beginLocal();
}
app.whenReady().then(start).catch(error=>{dialog.showErrorBox('Iniciar Loja de Roupas',error.message);app.quit();});
app.on('before-quit',event=>{
 if(!runtime||quitting)return;
 event.preventDefault();quitting=true;
 void runtime.stop().finally(()=>{runtime=null;app.quit();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
