import {test,expect} from '@playwright/test';

test('gestor recebe guia completo e pode pular e reabrir sem alterar vendas',async({page})=>{
 await page.goto('/');
 await page.getByLabel('Usuário').fill('qa-admin');
 await page.getByLabel('Senha').fill('Senha-QA-Somente-CI-2026');
 await page.getByRole('button',{name:'Entrar na loja'}).click();
 const tour=page.getByRole('dialog',{name:'Guia inicial da loja'});
 await expect(tour).toBeVisible();
 await expect(tour.getByText(/Passo 1 de/)).toBeVisible();
 await tour.getByRole('button',{name:'Próximo'}).click();
 await expect(tour.getByText(/Passo 2 de/)).toBeVisible();
 await tour.getByRole('button',{name:'Voltar'}).click();
 await expect(tour.getByText(/Passo 1 de/)).toBeVisible();
 await tour.getByRole('button',{name:'Pular tour'}).click();
 await expect(tour).toBeHidden();
 await page.reload();
 await page.getByLabel('Usuário').fill('qa-admin');
 await page.getByLabel('Senha').fill('Senha-QA-Somente-CI-2026');
 await page.getByRole('button',{name:'Entrar na loja'}).click();
 await expect(tour).toBeHidden();
 await page.getByRole('button',{name:'Reabrir tour'}).click();
 await expect(tour).toBeVisible();
 await tour.getByRole('button',{name:'Próximo'}).click();
 await tour.getByRole('button',{name:'Próximo'}).click();
 await expect(page.getByRole('heading',{name:'Produtos'})).toBeVisible();
});
