const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('lojaSetup',{
 state:()=>ipcRenderer.invoke('loja:setup-state'),
 create:(input)=>ipcRenderer.invoke('loja:setup-create',input),
 activate:(input)=>ipcRenderer.invoke('loja:setup-activate',input),
 remote:(origin)=>ipcRenderer.invoke('loja:setup-remote',origin),
 retry:()=>ipcRenderer.invoke('loja:setup-retry'),
 installVc:()=>ipcRenderer.invoke('loja:setup-install-vc'),
 onStatus:(callback)=>{
  const listener=(_event,message)=>callback(message);
  ipcRenderer.on('loja:setup-status',listener);
  return ()=>ipcRenderer.removeListener('loja:setup-status',listener);
 }
});
