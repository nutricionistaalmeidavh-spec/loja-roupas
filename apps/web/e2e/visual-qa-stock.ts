import {expect,type Page} from '@playwright/test';
export async function stockVisualProduct(page:Page,sku:string){
 await page.getByRole('button',{name:'Entrada de estoque'}).click();
 await page.getByRole('button',{name:'Receber estoque'}).click();
 const dialog=page.getByRole('dialog',{name:'Receber estoque'});
 await dialog.getByLabel('Localizar peça para recebimento (nome ou SKU)').fill(sku);
 const choice=dialog.getByLabel('Variante (SKU)');
 const option=choice.locator('option',{hasText:sku});
 await expect(option).toBeAttached();
 await choice.selectOption((await option.getAttribute('value'))!);
 await dialog.getByLabel('Quantidade recebida').fill('3');
 await dialog.getByRole('button',{name:'Registrar entrada de estoque'}).click();
 await expect(dialog.getByText(/Novo saldo em mãos: 3/)).toBeVisible();
 await dialog.getByRole('button',{name:'Fechar Receber estoque'}).click();
}
