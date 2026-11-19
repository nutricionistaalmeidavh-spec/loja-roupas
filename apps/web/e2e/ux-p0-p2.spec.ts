import {test,expect} from '@playwright/test';

test('P0: gestao nao amplia viewport de 390px',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/');
 await page.getByLabel('Usuário').fill('qa-admin');
 await page.getByLabel('Senha').fill('Senha-QA-Somente-CI-2026');
 await page.getByRole('button',{name:'Entrar na loja'}).click();
 await page.getByLabel('Página',{exact:true}).selectOption('gestao');
 await expect(page.getByRole('heading',{name:'Inteligência comercial'})).toBeVisible();
 await expect(page.getByRole('navigation',{name:'Atalhos da gestão'})).toBeVisible();
 await expect(page.getByRole('link',{name:'Inteligência',exact:true})).toHaveAttribute('href','#gestao-inteligencia');
 const size=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,document:document.documentElement.scrollWidth}));
 expect(size.document).toBeLessThanOrEqual(size.viewport+2);
 await page.screenshot({path:'test-results/gestao-p0-mobile-390.png',fullPage:true});
});
