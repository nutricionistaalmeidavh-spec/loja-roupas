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
 try{
  await Promise.race([
   setup.getByRole('heading',{name:'Crie sua loja'}).waitFor({timeout:110000}),
   setup.getByText('Não foi possível iniciar',{exact:true}).waitFor({timeout:110000})
    .then(()=>{throw new Error('Falha na inicialização do servidor local');})
  ]);
 }catch(error){
  console.error('Estado do assistente Windows:',await setup.locator('body').innerText().catch(()=>'<janela encerrada>'));
  throw error;
 }
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
 try {
  await appWindow.getByRole('heading',{name:'Bem-vindo à sua loja'}).waitFor({timeout:30000});
 } catch(error){
  console.error('Windows login URL:',appWindow.url());
  console.error('Windows page title:',await appWindow.title().catch(()=>'<sem titulo>'));
  console.error('Windows body:',(await appWindow.locator('body').innerText().catch(()=>'<sem body>')).slice(0,1500));
  console.error('Windows document:',await appWindow.evaluate(()=>({
   state:document.readyState,root:document.querySelector('#root')?.innerHTML.slice(0,500),
   scripts:[...document.scripts].map(s=>s.src).slice(0,5)
  })).catch(e=>({error:String(e)})));
  console.error('Setup state:',(await setup.locator('body').innerText().catch(()=>'<janela fechada>')).slice(0,1000));
  throw error;
 }
 const origin=new URL(appWindow.url()).origin;
 assert.equal(new URL(origin).hostname,'127.0.0.1');
 // Test the real installed native recovery IPC, without requiring internet
 // and without erasing or reinitializing PostgreSQL.
 const recoveryPromise=instance.waitForEvent('window',{timeout:15000});
 await appWindow.getByRole('button',{name:/Esqueci minha senha/}).click();
 const recovery=await recoveryPromise;
 await recovery.getByRole('heading',{name:'Recuperar acesso ao administrador'}).waitFor();
 await recovery.locator('input[name=login]').fill('local-admin');
 await recovery.locator('input[name=password]').fill('Senha-redefinida-CI-2026');
 await recovery.locator('input[name=confirmation]').fill('Senha-redefinida-CI-2026');
 await recovery.getByRole('button',{name:'Redefinir senha neste computador'}).click();
 await recovery.getByText('Senha alterada.',{exact:false}).waitFor({timeout:30000});
 await recovery.close();
 const old=await fetch(origin+'/v1/auth/sessions',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({login:'local-admin',password:'Senha-Local-CI-2026'})
 });
 assert.equal(old.status,401,'Senha antiga deve ser recusada após redefinição');
 await appWindow.getByLabel('Usuário').fill('local-admin');
 await appWindow.getByLabel('Senha').fill('Senha-redefinida-CI-2026');
 await appWindow.getByRole('button',{name:'Entrar na loja'}).click();
 await appWindow.getByRole('dialog',{name:'Guia inicial da loja'}).waitFor({timeout:12000});
 await appWindow.getByRole('button',{name:'Reabrir tour'}).waitFor();
 // Ensure the interface stays rendered after the first login and after a reload.
 await appWindow.waitForTimeout(2500);
 await appWindow.getByRole('button',{name:'Reabrir tour'}).waitFor();
 await appWindow.reload();
 await appWindow.getByRole('heading',{name:'Bem-vindo à sua loja'}).waitFor({timeout:15000});
 await appWindow.getByRole('button',{name:'Entrar na loja'}).waitFor();
 console.info('Windows one-computer: local PostgreSQL, login and stable renderer reload operational');
}finally{
 await instance?.close();
 await rm(userData,{recursive:true,force:true,maxRetries:8,retryDelay:500}).catch(error=>console.warn('Cleanup failed',error.message));
}
