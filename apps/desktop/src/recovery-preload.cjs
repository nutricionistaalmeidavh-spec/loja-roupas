'use strict';
const {contextBridge,ipcRenderer}=require('electron');
// Offline native dialog only. No database credentials or filesystem bridge.
contextBridge.exposeInMainWorld('lojaRecoveryNative',{
 reset:input=>ipcRenderer.invoke('loja:recovery:reset',input),
 restart:()=>ipcRenderer.invoke('loja:recovery:restart')
});
