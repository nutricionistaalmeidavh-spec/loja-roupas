import { test,expect } from '@playwright/test';

test('M3: caixa → venda com Pix manual + dinheiro → recibo não fiscal → fechamento',async({page},testInfo)=>{
 const sku='POS-QA-'+Math.random().toString(36).slice(2,10).toUpperCase();
 const productName='Jaqueta PDV QA '+sku;
 await page.addInitScript(()=>{
   window.print=()=>{
     document.documentElement.dataset.qaPrint = document.documentElement.dataset.receiptPaper ??
       (document.documentElement.dataset.printLabel ? 'label' : 'unknown');
   };
 });
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
 }else{
   await expect(page.getByText('Caixa aberto',{exact:true})).toBeVisible();
 }

 await page.getByRole('button',{name:'Cadastrar produtos'}).click();
 await page.getByRole('button',{name:/Novo produto/}).click();
 await page.getByLabel('Nome da peça').fill(productName);
 await page.getByLabel('SKU').fill(sku);
 await page.getByLabel('Cor').fill('Preto');
 await page.getByLabel('Tamanho').fill('M');
 await page.getByLabel('Preço (R$)').fill('149,90');
 const barcode='7'+String(Math.floor(Math.random()*10**11)).padStart(11,'0');
 await page.getByLabel('Código de barras (opcional)').fill(barcode);
 await page.getByRole('button',{name:'Cadastrar produto',exact:true}).click();
 await expect(page.getByText(/Produto cadastrado:/)).toBeVisible();
 await page.getByRole('button',{name:'Fechar Novo produto'}).click();
  await page.getByRole('button',{name:'Editar produto'}).click();
await page.getByRole('combobox',{name:'Produto para editar',exact:true}).selectOption({label:productName});
 const variantOption=page.getByRole('combobox',{name:'Variante para preço',exact:true}).locator('option',{hasText:sku});
 await expect(variantOption).toBeAttached();
 await page.getByRole('combobox',{name:'Variante para preço',exact:true}).selectOption((await variantOption.getAttribute('value'))!);
 await expect(page.getByRole('img',{name:'Code 128 para '+sku})).toBeVisible();
 await page.getByRole('button',{name:'Imprimir etiqueta'}).click();
 await expect(page.locator('html')).toHaveAttribute('data-qa-print','label');
 await page.locator('.barcode-label svg').screenshot({path:testInfo.outputPath('code128.png')});
 await page.evaluate(()=>document.documentElement.dataset.printLabel='true');
 await page.pdf({path:testInfo.outputPath('etiqueta.pdf'),width:'105mm',height:'45mm',printBackground:true});
 await page.evaluate(()=>delete document.documentElement.dataset.printLabel);

 await page.getByRole('button',{name:'Entrada de estoque'}).click();
 await page.getByRole('button',{name:'Receber estoque'}).click();
 await page.getByLabel('Localizar peça para recebimento (nome ou SKU)').fill(sku);
 const item=page.getByLabel('Variante (SKU)').locator('option',{hasText:sku});
 await expect(item).toBeAttached();
 await page.getByLabel('Variante (SKU)').selectOption((await item.getAttribute('value'))!);
 await page.getByLabel('Quantidade recebida').fill('5');
 await page.getByRole('button',{name:'Registrar entrada de estoque'}).click();
 await expect(page.getByText(/Novo saldo em mãos: 5/)).toBeVisible();
 await page.getByRole('button',{name:'Fechar Receber estoque'}).click();

 await page.getByRole('button',{name:'PDV',exact:true}).click();
 const scannerInput=page.getByLabel('Buscar nome, SKU ou código');
 await scannerInput.focus();
 await scannerInput.pressSequentially(barcode);
 await scannerInput.press('Enter');
 await expect(page.getByText('1 peça adicionada')).toBeVisible();
 await page.getByRole('button',{name:'Revisar e pagar'}).click();
 const dialog=page.getByRole('dialog',{name:'Revisar e finalizar venda'});
 await expect(dialog.getByText('R$ 149,90').first()).toBeVisible();
 await dialog.getByLabel('Método pagamento 1').selectOption('pix_manual');
 await dialog.getByLabel('Valor pagamento 1').fill('49,90');
 await dialog.getByLabel('Referência pagamento 1').fill('PIX-QA-'+sku);
 await dialog.getByLabel('Pagamento confirmado fora deste sistema e conferido').check();
 await dialog.getByRole('button',{name:'+ Adicionar pagamento'}).click();
 await dialog.getByLabel('Método pagamento 2').selectOption('cash');
 await dialog.getByLabel('Valor pagamento 2').fill('110,00');
 await dialog.getByLabel('Dinheiro recebido e conferido').check();
 await expect(dialog.getByText('R$ 10,00')).toBeVisible();
 await dialog.getByRole('button',{name:'Confirmar venda e pagamentos'}).click();
 const confirmation=page.getByRole('dialog',{name:'Venda confirmada'});
 await expect(confirmation).toBeVisible();
 await expect(confirmation.locator('pre.receipt-print')).toContainText('COMPROVANTE NÃO FISCAL');
 await expect(confirmation.getByText(/Troco: R\$\s?10,00/)).toBeVisible();
 for(const paper of [58,80]){
   await confirmation.getByRole('combobox').selectOption(String(paper));
   await confirmation.getByRole('button',{name:'Imprimir comprovante não fiscal'}).click();
   await expect(page.locator('html')).toHaveAttribute('data-qa-print',String(paper));
   await page.evaluate(value=>document.documentElement.dataset.receiptPaper=String(value),paper);
   await page.pdf({path:testInfo.outputPath('comprovante-'+paper+'.pdf'),width:paper+'mm',height:'180mm'});
   await page.evaluate(()=>delete document.documentElement.dataset.receiptPaper);
 }
 await confirmation.getByRole('button',{name:'Nova venda'}).click();

 await page.getByRole('button',{name:'Caixa',exact:true}).click();
 await page.getByRole('button',{name:'Fechar caixa',exact:true}).click();
 await page.getByLabel('Dinheiro contado (R$)').fill('200,00');
 await page.getByRole('button',{name:'Fechar e conferir caixa'}).click();
 await expect(page.getByText('Caixa fechado.')).toBeVisible();
 await page.getByRole('button',{name:'PDV',exact:true}).click();
 await expect(page.getByRole('button',{name:'Abra o caixa para vender'})).toBeDisabled();
 await page.screenshot({path:'test-results/m3-pdv-cash-closed.png',fullPage:true});
});
