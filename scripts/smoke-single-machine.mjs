import {strict as assert} from 'node:assert';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';

const require=createRequire(new URL('../apps/web/package.json',import.meta.url));
const {_electron:electron}=require('@playwright/test');
const executablePath=process.argv[2];
if(!executablePath||!path.isAbsolute(executablePath))throw Error('Electron absoluto obrigatório');
const userData=await mkdtemp(path.join(tmpdir(),'loja-local-pg-'));
let instance;
try{
 const env={...process.env};
 delete env.LOJA_SERVER_URL;
 instance=await electron.launch({executablePath,args:['--user-data-dir='+userData],
  chromiumSandbox:true,env,timeout:45000});
 const setup=await instance.firstWindow({timeout:25000});
 await setup.getByRole('heading',{name:'Crie sua loja'}).waitFor({timeout:110000});
 await setup.locator('input[name=name]').fill('Loja Local CI');
 await setup.locator('input[name=login]').fill('local-admin');
 await setup.locator('input[name=password]').fill('Senha-Local-CI-2026');
 await setup.getByRole('button',{name:'Criar loja e começar'}).click();
 const windows=instance.windows();
 let appWindow=windows.find(w=>w.url().startsWith('http://127.0.0.1:'));
 for(let i=0;i<150&&!appWindow;i++){
  await new Promise(resolve=>setTimeout(resolve,400));
  appWindow=instance.windows().find(w=>w.url().startsWith('http://127.0.0.1:'));
 }
 assert.ok(appWindow,'Aplicativo não abriu após bootstrap');
 await appWindow.getByRole('heading',{name:'Bem-vindo à sua loja'}).waitFor({timeout:15000});
 const origin=new URL(appWindow.url()).origin;
 assert.equal(new URL(origin).hostname,'127.0.0.1');
 await appWindow.getByLabel('Usuário').fill('local-admin');
 await appWindow.getByLabel('Senha').fill('Senha-Local-CI-2026');
 await appWindow.getByRole('button',{name:'Entrar na loja'}).click();
 await appWindow.getByRole('dialog',{name:'Guia inicial da loja'}).waitFor({timeout:12000});
 await appWindow.getByRole('button',{name:'Reabrir tour'}).waitFor();
 console.info('Windows one-computer: PostgreSQL, API, web, bootstrap and tour operational');
}finally{
 await instance?.close();
 await rm(userData,{recursive:true,force:true,maxRetries:8,retryDelay:500}).catch(error=>console.warn('Cleanup failed',error.message));
}
