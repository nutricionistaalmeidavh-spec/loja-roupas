import {expect,type Page} from '@playwright/test';
export async function createVisualProduct(page:Page){
 const sku='VQ-'+Math.random().toString(36).slice(2,10).toUpperCase();
 const name='Blusa Visual '+sku;
 await page.getByRole('button',{name:'Cadastrar produtos'}).click();
 await page.getByRole('button',{name:/Novo produto/}).click();
 const dialog=page.getByRole('dialog',{name:'Novo produto'});
 for(const [label,value] of [['Nome da peça',name],['SKU',sku],['Cor','Azul'],['Tamanho','M'],['Preço (R$)','149,90']]){
  await dialog.getByLabel(label,{exact:true}).fill(value);
 }
 await dialog.getByRole('button',{name:'Cadastrar produto',exact:true}).click();
 await expect(dialog.getByText(/Produto cadastrado:/)).toBeVisible();
 await dialog.getByRole('button',{name:'Fechar Novo produto'}).click();
 return {sku,name};
}
