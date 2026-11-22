import {test,expect} from '@playwright/test';
import writeExcelFile from 'write-excel-file/node';
import {randomUUID} from 'node:crypto';

test('P2: copiar/colar Excel, desfazer, lote atômico, exportar filtro e histórico',async({page},testInfo)=>{
 const unique=randomUUID().slice(0,8).toUpperCase();
 const product='Blusa P2 '+unique,sku='BULK-'+unique+'-P';
 const file=await writeExcelFile([
  ['produto','categoria','sku','cor','tamanho','preco','codigo_barras','estoque_inicial'],
  [product,'Feminino',sku,'Preto','P',99.90,null,2],
  [product,'Feminino','BULK-'+unique+'-M','Preto','M',99.90,null,3]
 ]).toBuffer();
 await page.goto('/');
 await page.getByLabel('Usuário').fill('qa-admin');
 await page.getByLabel('Senha').fill('Senha-QA-Somente-CI-2026');
 await page.getByRole('button',{name:'Entrar na loja'}).click();
 await page.getByRole('button',{name:'Cadastrar produtos'}).click();
 await page.getByRole('button',{name:'Importar planilha'}).click();
 const importer=page.getByRole('dialog',{name:'Importar produtos por planilha'});
 await importer.getByLabel('Arquivo XLSX ou CSV UTF-8').setInputFiles({
  name:'p2-'+unique+'.xlsx',buffer:file,
  mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
 });
 await expect(importer.getByText('Nenhum dado será gravado até a confirmação.')).toBeVisible();
 await importer.getByLabel('Justificativa para entrada direta de estoque (obrigatória)').fill('Carga inicial de estoque confirmada pelo gestor');
 await importer.getByRole('button',{name:'Confirmar importação'}).click();
 await expect(importer.getByRole('status').filter({hasText:'Importação concluída'})).toContainText('2 variantes');
 await importer.getByRole('button',{name:'Fechar Importar produtos por planilha'}).click();
 await page.getByRole('button',{name:'Planilha editável'}).click();
 await page.getByPlaceholder('Pesquisar no estoque').fill('BULK-'+unique);
 await expect(page.getByText('2 SKUs na página')).toBeVisible();
 await page.getByRole('button',{name:'Edição em lote / Colar Excel'}).click();
 const bulk=page.getByRole('dialog',{name:'Edição em lote — copiar e colar do Excel'});
 const textarea=bulk.getByLabel('Tabela TSV (copiar e colar do Excel)');
 const original=await textarea.inputValue();
 expect(original).toContain(sku);
 await bulk.getByRole('button',{name:'Selecionar tabela para copiar'}).click();
 const length=await textarea.evaluate(input=>(input as HTMLTextAreaElement).selectionEnd);
 expect(length).toBe(original.length);
 const modified=original.split(/\r?\n/).map(line=>line.startsWith(sku+'\t')
  ?line.replace('99,90','109,90'):line).join('\r\n');
 expect(modified).not.toBe(original);
 await textarea.fill(modified);
 await expect(bulk.getByRole('button',{name:'Salvar 1 alterações juntas'})).toBeEnabled();
 await bulk.getByRole('button',{name:'Desfazer alterações não salvas'}).click();
 await expect(textarea).toHaveValue(original);
 await textarea.fill(modified);
 await bulk.getByRole('button',{name:'Salvar 1 alterações juntas'}).click();
 await expect(page.getByRole('status').filter({hasText:'Edição em lote registrada'})).toBeVisible();
 await expect(page.getByRole('dialog',{name:'Edição em lote — copiar e colar do Excel'})).toHaveCount(0);
 const grid=page.getByRole('region',{name:'Planilha de produtos e estoque'});
 const row=grid.getByRole('row').filter({hasText:sku});
 await expect(row).toContainText('109,90');
 const downloadReady=page.waitForEvent('download');
 await page.getByRole('button',{name:'Exportar resultados filtrados XLSX'}).click();
 const download=await downloadReady;
 expect(download.suggestedFilename()).toBe('estoque_loja_roupas.xlsx');
 await expect(page.getByRole('status').filter({hasText:'SKUs filtrados exportados'})).toBeVisible();
 await page.getByRole('button',{name:'Histórico completo'}).click();
 const history=page.getByRole('dialog',{name:'Histórico completo de estoque'});
 await history.getByLabel('Tipo').selectOption('receipt');
 await expect(history.getByRole('region',{name:'Histórico de movimentações'})).toContainText(sku);
 await history.getByLabel('Operador').selectOption({index:1});
 await expect(history.getByText(/movimentações encontradas/)).toBeVisible();
 await history.getByRole('button',{name:'Limpar filtros'}).click();
 await history.getByRole('button',{name:'Fechar Histórico completo de estoque'}).click();
 await page.screenshot({path:testInfo.outputPath('p2-planilha-filtro-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await expect(page.getByRole('button',{name:'Edição em lote / Colar Excel'})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('p2-planilha-filtro-mobile.png'),fullPage:true});
});
