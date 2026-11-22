import {test,expect} from '@playwright/test';

async function login(page:import('@playwright/test').Page){
 await page.goto('/');
 await page.getByLabel('Usuário').fill('qa-admin');
 await page.getByLabel('Senha').fill('Senha-QA-Somente-CI-2026');
 await page.getByRole('button',{name:'Entrar na loja'}).click();
 await expect(page.getByRole('heading',{name:'Nova venda'})).toBeVisible();
}

test('Estoque mantém a navegação visível quando o chunk da planilha falha',async({page})=>{
 await page.route(/\/assets\/InventorySpreadsheet-[^/]+\.js(?:\?.*)?$/,route=>route.abort('failed'));
 await login(page);
 await page.getByRole('button',{name:'Entrada de estoque'}).click();
 await expect(page.getByRole('heading',{name:'Estoque da loja'})).toBeVisible();
 await expect(page.getByRole('alert').filter({hasText:'Não foi possível abrir o estoque'})).toBeVisible({timeout:15000});
 await page.getByRole('button',{name:'PDV',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Nova venda'})).toBeVisible();
});

test('abrir Estoque não dispara busca adicional de catálogo do recebimento',async({page})=>{
 let productsRequests=0;
 await login(page);
 await page.waitForResponse(r=>r.url().includes('/v1/catalog/products?')&&r.status()===200).catch(()=>{});
 page.on('request',r=>{if(r.url().includes('/v1/catalog/products?'))productsRequests++;});
 await page.getByRole('button',{name:'Entrada de estoque'}).click();
 await expect(page.getByRole('heading',{name:'Planilha operacional'})).toBeVisible({timeout:15000});
 await page.waitForTimeout(700);
 expect(productsRequests).toBe(0);
});

test('Estoque mostra erro útil quando sua API não responde, sem bloquear PDV',async({page})=>{
 test.setTimeout(30000);
 await login(page);
 await page.route('**/v1/stock/spreadsheet?*',async()=>new Promise<void>(()=>{}));
 await page.getByRole('button',{name:'Entrada de estoque'}).click();
 await expect(page.getByRole('alert').filter({hasText:'A consulta de estoque demorou demais'})).toBeVisible({timeout:18000});
 await page.getByRole('button',{name:'PDV',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Nova venda'})).toBeVisible();
});
