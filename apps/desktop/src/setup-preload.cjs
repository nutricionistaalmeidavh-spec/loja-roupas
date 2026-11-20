const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('lojaSetup',{
 state:()=>ipcRenderer.invoke('loja:setup-state'),
 create:(input)=>ipcRenderer.invoke('loja:setup-create',input),
 remote:(origin)=>ipcRenderer.invoke('loja:setup-remote',origin),
 onStatus:(callback)=>{
  const listener=(_event,message)=>callback(message);
  ipcRenderer.on('loja:setup-status',listener);
  return ()=>ipcRenderer.removeListener('loja:setup-status',listener);
 }
});
