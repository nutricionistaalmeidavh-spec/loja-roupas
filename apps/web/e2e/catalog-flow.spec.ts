import { test, expect } from '@playwright/test';

test('gestor faz login, cadastra peça e recebe estoque real sem habilitar pagamento', async ({page}) => {
  const sku = 'E2E-' + Math.random().toString(36).slice(2,10).toUpperCase();
  const name = 'Blusa QA ' + sku;

  await page.goto('/');
  await expect(page.getByRole('heading', {name:'Bem-vindo à sua loja'})).toBeVisible();
  await page.getByLabel('Usuário').fill('qa-admin');
  await page.getByLabel('Senha').fill('Senha-QA-Somente-CI-2026');
  await page.getByRole('button', {name:'Entrar na loja'}).click();
  await expect(page.getByRole('heading', {name:'Nova venda'})).toBeVisible();

  await page.getByRole('button', {name:'Cadastrar produtos'}).click();
  await page.getByRole('button',{name:/Novo produto/}).click();
  await page.getByLabel('Nome da peça').fill(name);
  await page.getByLabel('SKU').fill(sku);
  await page.getByLabel('Cor').fill('Azul');
  await page.getByLabel('Tamanho').fill('M');
  await page.getByLabel('Preço (R$)').fill('129,90');
  await page.getByRole('button', {name:'Cadastrar produto', exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Produto cadastrado'})).toBeVisible();
  await page.getByRole('button',{name:'Fechar Novo produto'}).click();

  await page.getByRole('button', {name:'Entrada de estoque'}).click();
  await page.getByRole('button',{name:'Receber estoque'}).click();
  const select = page.getByLabel('Variante (SKU)');
  const option = select.locator('option', {hasText:sku});
  await expect(option).toBeAttached();
  const variantId = await option.getAttribute('value');
  expect(variantId).toBeTruthy();
  await select.selectOption(variantId!);
  await page.getByLabel('Quantidade recebida').fill('3');
  await page.getByRole('button', {name:'Registrar entrada de estoque'}).click();
  await expect(page.getByRole('status').filter({hasText:'Novo saldo em mãos: 3'})).toBeVisible();
  await page.getByRole('button',{name:'Fechar Receber estoque'}).click();

  await page.getByRole('button', {name:'PDV'}).click();
  const card=page.locator('.product-card').filter({hasText:name});
  await expect(card).toBeVisible();
  await expect(card.getByText('3 disponíveis')).toBeVisible();
  await card.getByRole('button', {name:'Adicionar '+name}).click();
  await expect(page.getByText('1 peça adicionada')).toBeVisible();
  await expect(page.getByRole('button', {name:/Abra o caixa para vender/})).toBeDisabled();
  await page.screenshot({path:'test-results/retail-pdv-desktop.png',fullPage:true});

  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('button',{name:/Ver carrinho/})).toBeVisible();
  await page.getByRole('button',{name:/Ver carrinho/}).click();
  await expect(page.getByRole('dialog',{name:'Carrinho'})).toBeVisible();
  await page.screenshot({path:'test-results/retail-pdv-mobile.png',fullPage:true});
  await page.reload();
  await expect(page.getByRole('heading', {name:'Bem-vindo à sua loja'})).toBeVisible();
});
