import {expect,type Page} from '@playwright/test';
export async function stockVisualProduct(page:Page,sku:string){
 await page.getByRole('button',{name:'Entrada de estoque'}).click();
 await page.getByLabel('Localizar peça para recebimento (nome ou SKU)').fill(sku);
 const choice=page.getByLabel('Variante (SKU)');
 const option=choice.locator('option',{hasText:sku});
 await expect(option).toBeAttached();
 await choice.selectOption((await option.getAttribute('value'))!);
 await page.getByLabel('Quantidade recebida').fill('3');
 await page.getByRole('button',{name:'Registrar entrada de estoque'}).click();
 await expect(page.getByText(/Novo saldo em mãos: 3/)).toBeVisible();
}