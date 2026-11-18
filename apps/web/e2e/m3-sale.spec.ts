import { test,expect } from '@playwright/test';

test('M3: caixa → venda com Pix manual + dinheiro → recibo não fiscal → fechamento',async({page})=>{
 const sku='POS-QA-'+Math.random().toString(36).slice(2,10).toUpperCase();
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
 await page.getByLabel('Nome da peça').fill('Jaqueta PDV QA');
 await page.getByLabel('SKU').fill(sku);
 await page.getByLabel('Cor').fill('Preto');
 await page.getByLabel('Tamanho').fill('M');
 await page.getByLabel('Preço (R$)').fill('149,90');
 await page.getByRole('button',{name:'Cadastrar produto',exact:true}).click();
 await expect(page.getByText(/Produto cadastrado:/)).toBeVisible();

 await page.getByRole('button',{name:'Entrada de estoque'}).click();
 await page.getByLabel('Localizar peça para recebimento (nome ou SKU)').fill(sku);
 const item=page.getByLabel('Variante (SKU)').locator('option',{hasText:sku});
 await expect(item).toBeAttached();
 await page.getByLabel('Variante (SKU)').selectOption((await item.getAttribute('value'))!);
 await page.getByLabel('Quantidade recebida').fill('5');
 await page.getByRole('button',{name:'Registrar entrada de estoque'}).click();
 await expect(page.getByText(/Novo saldo em mãos: 5/)).toBeVisible();

 await page.getByRole('button',{name:'PDV'}).click();
 await page.getByLabel('Buscar nome, SKU ou código').fill(sku);
 const card=page.locator('.product-card').filter({hasText:'Jaqueta PDV QA'});
 await expect(card).toBeVisible();
 await card.getByRole('button',{name:'Adicionar Jaqueta PDV QA'}).click();
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
 await confirmation.getByRole('button',{name:'Nova venda'}).click();

 await page.getByRole('button',{name:'Caixa',exact:true}).click();
 await page.getByLabel('Dinheiro contado (R$)').fill('200,00');
 await page.getByRole('button',{name:'Fechar e conferir caixa'}).click();
 await expect(page.getByText('Caixa fechado.')).toBeVisible();
 await page.getByRole('button',{name:'PDV'}).click();
 await expect(page.getByRole('button',{name:'Abra o caixa para vender'})).toBeDisabled();
 await page.screenshot({path:'test-results/m3-pdv-cash-closed.png',fullPage:true});
});
