import {test,expect} from '@playwright/test';

test('jetlog ao abrir e atualização em Configurações nunca fazem download sem clique',async({page})=>{
 await page.addInitScript(()=>{
  Object.assign(window,{
   __installCount:0,
   __checkCount:0,
   lojaUpdates:{
    async info(){return {supported:true,currentVersion:'0.1.0'};},
    async check(){
     (window as unknown as {__checkCount:number}).__checkCount++;
     return {supported:true,currentVersion:'0.1.0',available:{
      version:'0.2.0',notes:'Correções de estabilidade\nMelhoria de estoque',size:15200000}};
    },
    async install(){(window as unknown as {__installCount:number}).__installCount++;return {started:false,cancelled:true};},
    async lastResult(){return null;},
    onProgress(){return ()=>{};}
   }
  });
 });
 await page.goto('/');
 const modal=page.getByRole('dialog',{name:/Uma nova versão da Loja de Roupas/});
 await expect(modal).toBeVisible();
 await expect(modal.getByText('v0.2.0')).toBeVisible();
 await expect(modal.getByText(/Correções de estabilidade/)).toBeVisible();
 expect(await page.evaluate(()=>(window as unknown as {__installCount:number}).__installCount)).toBe(0);
 await modal.getByRole('button',{name:'Agora não'}).click();
 await expect(modal).toHaveCount(0);
 expect(await page.evaluate(()=>(window as unknown as {__installCount:number}).__installCount)).toBe(0);
 await page.getByLabel('Usuário').fill('qa-admin');
 await page.getByLabel('Senha').fill('Senha-QA-Somente-CI-2026');
 await page.getByRole('button',{name:'Entrar na loja'}).click();
 await page.getByRole('button',{name:'Configurações'}).click();
 await expect(page.getByRole('heading',{name:'Atualizações do sistema'})).toBeVisible();
 await page.getByRole('button',{name:'Verificar atualizações agora'}).click();
 await expect(page.getByText('v0.2.0')).toBeVisible();
 expect(await page.evaluate(()=>(window as unknown as {__installCount:number}).__installCount)).toBe(0);
 await page.getByRole('button',{name:'Baixar e instalar atualização'}).click();
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {__installCount:number}).__installCount)).toBe(1);
});

test('navegador sem bridge não mostra jetlog nem permite instalar',async({page})=>{
 await page.goto('/');
 await expect(page.getByRole('dialog',{name:/Uma nova versão/})).toHaveCount(0);
 await page.getByLabel('Usuário').fill('qa-admin');
 await page.getByLabel('Senha').fill('Senha-QA-Somente-CI-2026');
 await page.getByRole('button',{name:'Entrar na loja'}).click();
 await page.getByRole('button',{name:'Configurações'}).click();
 await expect(page.getByText(/A atualização do aplicativo Windows é gerenciada/)).toBeVisible();
 await expect(page.getByRole('button',{name:'Baixar e instalar atualização'})).toHaveCount(0);
});
