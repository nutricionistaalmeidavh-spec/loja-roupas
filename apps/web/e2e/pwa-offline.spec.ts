import {expect,test} from '@playwright/test';

test('PWA compilada informa indisponibilidade e volta quando o servidor responde',async({page,context})=>{
  test.skip(process.env.LOJA_E2E_BUILT!=='1','Exige o bundle de produção e o service worker ativo');
  await page.goto('/');
  await expect(page.getByLabel('Usuário')).toBeVisible();
  await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
  const manifest=await page.request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBeTruthy();
  expect((await manifest.json()).display).toBe('standalone');
  await context.setOffline(true);
  try{
    const response=await page.reload();
    expect(response?.status()).toBe(503);
    await expect(page.getByRole('heading',{name:'Servidor indisponível'})).toBeVisible();
    await expect(page.getByLabel('Usuário')).toHaveCount(0);
  }finally{
    await context.setOffline(false);
  }
  await page.reload();
  await expect(page.getByLabel('Usuário')).toBeVisible();
});
