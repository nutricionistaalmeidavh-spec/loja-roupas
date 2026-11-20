import {test,expect} from '@playwright/test';
import writeExcelFile from 'write-excel-file/node';
import {randomUUID} from 'node:crypto';

test('P0/P1: importação XLSX, consulta, edição e recebimento na planilha',async({page},testInfo)=>{
 const suffix=randomUUID().slice(0,8).toUpperCase();
 const name='Blusa XLSX '+suffix,sku='XLS-'+suffix+'-P',barcode='000'+suffix.replace(/[^0-9A-Z]/g,'')+'0123';
 const file=await writeExcelFile([
  ['produto','categoria','sku','cor','tamanho','preco','codigo_barras','estoque_inicial'],
  [name,'Feminino',sku,'Preto','P',99.90,barcode,2],
  [name,'Feminino','XLS-'+suffix+'-M','Preto','M',99.90,null,3]
 ]).toBuffer();
 await page.goto('/');
 await page.getByLabel('Usuário').fill('qa-admin');
 await page.getByLabel('Senha').fill('Senha-QA-Somente-CI-2026');
 await page.getByRole('button',{name:'Entrar na loja'}).click();
 await page.getByRole('button',{name:'Cadastrar produtos'}).click();
 await page.getByRole('button',{name:'Importar planilha'}).click();
 const importer=page.getByRole('dialog',{name:'Importar produtos por planilha'});
 await expect(importer.getByRole('button',{name:'Baixar modelo XLSX'})).toBeVisible();
 await importer.getByLabel('Arquivo XLSX ou CSV UTF-8').setInputFiles({
  name:'roupas-'+suffix+'.xlsx',
  mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  buffer:file
 });
 await expect(importer.getByText('Nenhum dado será gravado até a confirmação.')).toBeVisible();
 await importer.getByRole('button',{name:'Confirmar importação'}).click();
 await expect(importer.getByRole('status').filter({hasText:'Importação concluída'})).toContainText('2 variantes');
 await importer.getByRole('button',{name:'Fechar Importar produtos por planilha'}).click();
 await page.getByRole('button',{name:'Planilha editável'}).click();
 await page.getByPlaceholder('Pesquisar no estoque').fill(sku);
 const grid=page.getByRole('region',{name:'Planilha de produtos e estoque'});
 const row=grid.getByRole('row').filter({hasText:sku});
 await expect(row).toBeVisible();
 await expect(row.getByRole('gridcell').nth(9)).toHaveText('2');
 await row.getByRole('gridcell',{name:sku,exact:true}).click();
 await page.getByRole('button',{name:'Histórico selecionado '+sku}).click();
 const history=page.getByRole('dialog',{name:'Histórico — '+sku});
 await expect(history.getByText('Recebimento')).toBeVisible();
 await expect(history.getByText('+2 peças')).toBeVisible();
 await history.getByRole('button',{name:'Fechar Histórico — '+sku}).click();
 await page.getByRole('button',{name:'Receber selecionado '+sku}).click();
 const incoming=page.getByRole('dialog',{name:'Receber peças — '+sku});
 await expect(incoming.getByLabel('Variante (SKU)')).toHaveValue(/.+/);
 await incoming.getByLabel('Quantidade recebida').fill('4');
 await incoming.getByRole('button',{name:'Registrar entrada de estoque'}).click();
 await expect(incoming.getByText(/Novo saldo em mãos: 6/)).toBeVisible();
 await incoming.getByRole('button',{name:'Fechar Receber peças — '+sku}).click();
 await expect(row.getByRole('gridcell').nth(9)).toHaveText('6');
 const cell=row.getByRole('gridcell',{name:name,exact:true});
 await cell.dblclick();
 await cell.locator('input').fill(name+' editada');
 await cell.locator('input').press('Enter');
 await row.getByRole('button',{name:'Salvar alterações de '+sku}).click();
 await expect(page.getByRole('status').filter({hasText:'Alterações salvas'})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('planilha-p1-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await expect(page.getByRole('heading',{name:'Planilha operacional'})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('planilha-p1-mobile.png'),fullPage:true});
});
