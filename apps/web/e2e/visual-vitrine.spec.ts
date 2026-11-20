import {test,expect} from '@playwright/test';
test('captura vitrine publica',async({page,context},info)=>{
 await page.goto('/');
 await page.getByLabel('Usuário').fill('qa-admin');
 await page.getByLabel('Senha').fill('Senha-QA-Somente-CI-2026');
 await page.getByRole('button',{name:'Entrar na loja'}).click();
 await page.getByRole('button',{name:'Gestão',exact:true}).click();
 await page.getByRole('link',{name:'Vitrine',exact:true}).click();
 const href=await page.getByRole('link',{name:'Abrir vitrine da loja'}).getAttribute('href');
 expect(href).toBeTruthy();
 const storefront=await context.newPage();
 await storefront.goto(new URL(href!,page.url()).toString());
 await expect(storefront.getByRole('heading',{name:'Vitrine'})).toBeVisible();
 await storefront.screenshot({path:info.outputPath('vitrine-publica.png'),fullPage:true});
});