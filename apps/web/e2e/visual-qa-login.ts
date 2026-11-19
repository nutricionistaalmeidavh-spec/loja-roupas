import {expect,type Page} from '@playwright/test';
export async function loginWithCash(page:Page){
 await page.goto('/');
 await page.getByLabel('Usuário').fill('qa-admin');
 await page.getByLabel('Senha').fill('Senha-QA-Somente-CI-2026');
 await page.getByRole('button',{name:'Entrar na loja'}).click();
 await page.getByRole('button',{name:'Caixa',exact:true}).click();
 await expect(page.getByText('Consultando caixa no servidor…')).toBeHidden();
 if(await page.getByRole('button',{name:'Abrir caixa',exact:true}).count()){
  await page.getByLabel('Valor inicial (R$)').fill('100,00');
  await page.getByRole('button',{name:'Abrir caixa',exact:true}).click();
  await expect(page.getByText('Caixa aberto.')).toBeVisible();
 }
}