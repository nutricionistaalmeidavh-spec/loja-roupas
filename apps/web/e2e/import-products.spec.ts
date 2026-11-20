import {test,expect} from '@playwright/test';
test('importa planilha CSV com prévia, variantes, estoque e modelo para baixar',async({page})=>{
 const suffix=Math.random().toString(36).slice(2,10).toUpperCase();
 const sku1='PLAN-'+suffix+'-P',sku2='PLAN-'+suffix+'-M';
 const name='Camisa Importação '+suffix;
 const csv='\uFEFFproduto;categoria;sku;cor;tamanho;preco;codigo_barras;estoque_inicial\r\n'
  +name+';Feminino;'+sku1+';Azul;P;129,90;;2\r\n'
  +name+';Feminino;'+sku2+';Azul;M;129,90;;3\r\n';
 await page.goto('/');
 await page.getByLabel('Usuário').fill('qa-admin');
 await page.getByLabel('Senha').fill('Senha-QA-Somente-CI-2026');
 await page.getByRole('button',{name:'Entrar na loja'}).click();
 await page.getByRole('button',{name:'Cadastrar produtos'}).click();
 await page.getByRole('button',{name:'Importar planilha'}).click();
 const dialog=page.getByRole('dialog',{name:'Importar produtos por planilha'});
 await expect(dialog).toBeVisible();
 const [download]=await Promise.all([
  page.waitForEvent('download'),
  dialog.getByRole('button',{name:'Baixar modelo da planilha (.csv)'}).click()
 ]);
 expect(download.suggestedFilename()).toBe('modelo-importacao-produtos.csv');
 await dialog.locator('input[type=file]').setInputFiles({name:'roupas.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
 await expect(dialog.getByText('1 produtos')).toBeVisible();
 await expect(dialog.getByText('2 variantes')).toBeVisible();
 await dialog.getByRole('button',{name:'Confirmar importação'}).click();
 await expect(dialog.getByText(/Importação concluída: 1 produtos, 2 variantes e 5 unidades/)).toBeVisible();
 await dialog.getByRole('button',{name:'Fechar Importar produtos por planilha'}).click();
 await page.getByRole('button',{name:'PDV'}).click();
 await page.getByLabel('Buscar nome, SKU ou código').fill(sku1);
 const card=page.locator('.product-card').filter({hasText:name});
 await expect(card).toBeVisible();
 await expect(card.getByText('2 disponíveis')).toBeVisible();
});
