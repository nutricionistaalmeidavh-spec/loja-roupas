'use strict';
const {contextBridge,ipcRenderer}=require('electron');
// Narrow read/action bridge. No filesystem, arbitrary URLs, or shell access.
contextBridge.exposeInMainWorld('lojaPrinter',{
 list:()=>ipcRenderer.invoke('loja:printers:list'),
 print:(request)=>ipcRenderer.invoke('loja:printers:print',request)
});
contextBridge.exposeInMainWorld('lojaBackups',{
 create:auth=>ipcRenderer.invoke('loja:backup:create',auth),
 verify:auth=>ipcRenderer.invoke('loja:backup:verify',auth),
 autoStatus:auth=>ipcRenderer.invoke('loja:backup:auto-status',auth),
 autoFolder:auth=>ipcRenderer.invoke('loja:backup:auto-folder',auth),
 autoRun:auth=>ipcRenderer.invoke('loja:backup:auto-run',auth),
 restore:auth=>ipcRenderer.invoke('loja:backup:restore',auth)
});
contextBridge.exposeInMainWorld('lojaUpdates',{
 info:()=>ipcRenderer.invoke('loja:updates:info'),
 check:()=>ipcRenderer.invoke('loja:updates:check'),
 lastResult:()=>ipcRenderer.invoke('loja:updates:last-result'),
 install:()=>ipcRenderer.invoke('loja:updates:install'),
 onProgress:callback=>{
  if(typeof callback!=='function')throw new TypeError('Callback obrigatório');
  const listener=(_event,value)=>callback(value);
  ipcRenderer.on('loja:updates:progress',listener);
  return ()=>ipcRenderer.removeListener('loja:updates:progress',listener);
 }
});

 // The web renderer can only request a separate native recovery dialog.
 // It cannot update passwords, read files, or query PostgreSQL directly.
 contextBridge.exposeInMainWorld('lojaRecovery',{
  available:()=>ipcRenderer.invoke('loja:recovery:available'),
  open:()=>ipcRenderer.invoke('loja:recovery:open')
 });
