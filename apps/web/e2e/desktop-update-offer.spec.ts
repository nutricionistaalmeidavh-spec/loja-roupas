import {test,expect} from '@playwright/test';

test('instalação física habilitada oferece release mais nova na abertura, com opt-in',async({page})=>{
 await page.addInitScript(()=>{
  (window as any).__lojaTestInstallCalls=0;
  (window as any).lojaUpdates={
   info:async()=>({supported:true,currentVersion:'0.2.4'}),
   check:async()=>({supported:true,currentVersion:'0.2.4',
    available:{version:'0.2.5',notes:'Melhorias no controle de caixa',size:250000000}}),
   lastResult:async()=>null,
   install:async()=>{(window as any).__lojaTestInstallCalls++;return {started:false,cancelled:true};},
   onProgress:()=>()=>{}
  };
 });
 await page.goto('/');
 const dialog=page.getByRole('dialog',{name:'Atualização da loja'});
 await expect(dialog).toBeVisible();
 await expect(dialog.getByText('v0.2.5')).toBeVisible();
 await expect(dialog.getByText('O download começa somente depois da sua confirmação.')).toBeVisible();
 await dialog.getByRole('button',{name:'Agora não'}).click();
 await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).__lojaTestInstallCalls)).toBe(0);
});

test('instalação sem atualização disponível não apresenta aviso',async({page})=>{
 await page.addInitScript(()=>{
  (window as any).lojaUpdates={
   info:async()=>({supported:true,currentVersion:'0.2.4'}),
   check:async()=>({supported:true,currentVersion:'0.2.4',available:null}),
   lastResult:async()=>null,install:async()=>({started:false}),
   onProgress:()=>()=>{}
  };
 });
 await page.goto('/');
 await expect(page.getByRole('dialog',{name:'Atualização da loja'})).toHaveCount(0);
});
