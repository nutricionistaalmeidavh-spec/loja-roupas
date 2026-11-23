import {test,expect} from '@playwright/test';

test('a janela de atualização é visual e não mostra release notes nem detalhes técnicos',async({page})=>{
 await page.addInitScript(()=>{
  (window as any).lojaUpdates={
   info:async()=>({supported:true,currentVersion:'0.2.4'}),
   check:async()=>({supported:true,currentVersion:'0.2.4',
    available:{version:'0.2.5',notes:'## Correções técnicas\nSHA-256, PostgreSQL e código interno',size:250000000}}),
   lastResult:async()=>null,
   install:async()=>({started:false,cancelled:true}),
   onProgress:()=>()=>{}
  };
 });
 await page.goto('/');
 const dialog=page.getByRole('dialog',{name:'Atualização da loja'});
 await expect(dialog).toBeVisible();
 await expect(dialog.locator('.update-motion')).toBeVisible();
 await expect(dialog.getByText('v0.2.5')).toBeVisible();
 await expect(dialog.getByText('O que mudou')).toHaveCount(0);
 await expect(dialog.getByText(/PostgreSQL|SHA-256|Correções técnicas/)).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'Atualizar agora'})).toBeEnabled();
});

test('download mostra o percentual real e etapas sem simular progresso',async({page})=>{
 await page.addInitScript(()=>{
  const listeners:Array<(value:any)=>void>=[];
  (window as any).__emitUpdateProgress=(value:any)=>listeners.forEach(fn=>fn(value));
  (window as any).lojaUpdates={
   info:async()=>({supported:true,currentVersion:'0.2.4'}),
   check:async()=>({supported:true,currentVersion:'0.2.4',
    available:{version:'0.2.5',notes:'## Detalhes técnicos',size:250000000}}),
   lastResult:async()=>null,
   install:async()=>({started:true}),
   onProgress:(callback:(value:any)=>void)=>{listeners.push(callback);return ()=>{};}
  };
 });
 await page.goto('/');
 const dialog=page.getByRole('dialog',{name:'Atualização da loja'});
 await dialog.getByRole('button',{name:'Atualizar agora'}).click();
 await expect(dialog.getByRole('heading',{name:'Atualizando sua loja'})).toBeVisible();
 await expect(dialog.getByRole('progressbar',{name:'Download da atualização'})).toHaveCount(0);
 await page.evaluate(()=>(window as any).__emitUpdateProgress({phase:'download',bytes:125000000,total:250000000}));
 await expect(dialog.getByRole('progressbar',{name:'Download da atualização'})).toHaveAttribute('aria-valuenow','50');
 await expect(dialog.getByText('50%')).toBeVisible();
 await page.evaluate(()=>(window as any).__emitUpdateProgress({phase:'backup'}));
 await expect(dialog.getByText('Protegendo seus dados')).toBeVisible();
 await expect(dialog.getByRole('progressbar',{name:'Download da atualização'})).toHaveCount(0);
});

test('falhas apresentam mensagem simples e detalhes recolhidos',async({page})=>{
 await page.addInitScript(()=>{
  const listeners:Array<(value:any)=>void>=[];
  (window as any).__emitUpdateProgress=(value:any)=>listeners.forEach(fn=>fn(value));
  (window as any).lojaUpdates={
   info:async()=>({supported:true,currentVersion:'0.2.4'}),
   check:async()=>({supported:true,currentVersion:'0.2.4',
    available:{version:'0.2.5',notes:'',size:250000000}}),
   lastResult:async()=>null,
   install:async()=>new Promise(()=>{}),
   onProgress:(callback:(value:any)=>void)=>{listeners.push(callback);return ()=>{};}
  };
 });
 await page.goto('/');
 const dialog=page.getByRole('dialog',{name:'Atualização da loja'});
 await dialog.getByRole('button',{name:'Atualizar agora'}).click();
 await page.evaluate(()=>(window as any).__emitUpdateProgress({phase:'error',message:'SHA-256: invalid checksum'}));
 await expect(dialog.getByRole('alert')).toContainText('Não foi possível concluir a atualização');
 await expect(dialog.getByText('SHA-256: invalid checksum')).toBeHidden();
 await expect(dialog.getByRole('button',{name:'Atualizar agora'})).toBeEnabled();
});

test('tentativa anterior malsucedida fica visível quando a atualização volta a ser oferecida',async({page})=>{
 await page.addInitScript(()=>{
  (window as any).lojaUpdates={
   info:async()=>({supported:true,currentVersion:'0.2.4'}),
   check:async()=>({supported:true,currentVersion:'0.2.4',
    available:{version:'0.2.5',notes:'Interno do instalador',size:250000000}}),
   lastResult:async()=>({status:'failed',message:'Não foi possível substituir os arquivos; versão anterior restaurada'}),
   install:async()=>({started:false,cancelled:true}),
   onProgress:()=>()=>{}
  };
 });
 await page.goto('/');
 const dialog=page.getByRole('dialog',{name:'Atualização da loja'});
 await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('alert')).toContainText('Não foi possível concluir a atualização.');
 await expect(dialog.getByText('Não foi possível substituir os arquivos; versão anterior restaurada')).toBeHidden();
 await expect(dialog.getByRole('button',{name:'Atualizar agora'})).toBeEnabled();
});
