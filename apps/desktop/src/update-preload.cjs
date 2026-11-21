'use strict';
const {contextBridge,ipcRenderer}=require('electron');
// Narrow read/action bridge. No filesystem, arbitrary URLs, or shell access.
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
