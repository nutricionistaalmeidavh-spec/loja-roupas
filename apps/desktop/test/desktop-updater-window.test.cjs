const test=require('node:test');
const assert=require('node:assert/strict');
const {createDesktopUpdater}=require('../src/desktop-updater.cjs');

test('janela Electron é removida sem ler webContents após destruição',()=>{
 const handlers=new Map();
 const app={getVersion:()=> '0.1.0',getPath:()=>'/tmp/loja-qa'};
 const ipcMain={handle:(key,fn)=>handlers.set(key,fn)};
 const manager=createDesktopUpdater({app,ipcMain,BrowserWindow:{},dialog:{}});
 assert.equal(handlers.has('loja:updates:check'),true);
 assert.equal(handlers.has('loja:updates:install'),true);
 let destroyed=false,onClosed=null;
 const contents={getURL:()=> 'http://127.0.0.1:1234/',isDestroyed:()=>destroyed,send:()=>{}};
 const window={
  get webContents(){if(destroyed)throw new Error('BrowserWindow destruído');return contents;},
  once(event,cb){assert.equal(event,'closed');onClosed=cb;}
 };
 manager.registerWindow(window,'http://127.0.0.1:1234/');
 destroyed=true;
 assert.doesNotThrow(()=>onClosed());
});

test('edição física não instala executável sem instalação Windows e canal próprio',async()=>{
 const handlers=new Map();
 const app={getVersion:()=> '0.2.3',getPath:()=>'/tmp/loja-qa'};
 const ipcMain={handle:(key,fn)=>handlers.set(key,fn)};
 const updater=createDesktopUpdater({app,ipcMain,BrowserWindow:{},dialog:{},physicalEdition:true});
 const content={getURL:()=> 'http://127.0.0.1:8090/',isDestroyed:()=>false,send:()=>{}};
 updater.registerWindow({webContents:content,once(){}},'http://127.0.0.1:8090/');
 const event={sender:content};
 const info=await handlers.get('loja:updates:info')(event);
 assert.equal(info.supported,false);
 const check=await handlers.get('loja:updates:check')(event);
 assert.equal(check.available,null);
 await assert.rejects(handlers.get('loja:updates:install')(event),/instalador.*indisponível/i);
});
