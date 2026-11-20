import {expect,type Page} from '@playwright/test';
export async function createVisualProduct(page:Page){
 const sku='VQ-'+Math.random().toString(36).slice(2,10).toUpperCase();
 const name='Blusa Visual '+sku;
 await page.getByRole('button',{name:'Cadastrar produtos'}).click();
 for(const [label,value] of [['Nome da peça',name],['SKU',sku],['Cor','Azul'],['Tamanho','M'],['Preço (R$)','149,90']]){
   await page.getByLabel(label,{exact:true}).fill(value);
 }
 await page.getByRole('button',{name:'Cadastrar produto',exact:true}).click();
 await expect(page.getByText(/Produto cadastrado:/)).toBeVisible();
 return {sku,name};
}