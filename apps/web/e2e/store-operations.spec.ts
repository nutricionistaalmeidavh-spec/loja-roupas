import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

test('gestão, compra, retirada e acompanhamento chegam à vitrine', async ({page,request}) => {
  const login = {login:'qa-admin',password:'Senha-QA-Somente-CI-2026'};
  const response = await request.post('/v1/auth/sessions',{data:login});
  expect(response.ok()).toBeTruthy();
  const {token,stores} = await response.json();
  const store = stores[0].store_id;
  const headers = () => ({authorization:'Bearer '+token,'x-store-id':store,'idempotency-key':randomUUID()});
  const suffix = randomUUID().slice(0,8);
  const name = 'Camisa vitrine '+suffix;
  const sku = 'VIT-'+suffix;
  const supplier = 'Fornecedor '+suffix;
  const product = await request.post('/v1/catalog/products',{headers:headers(),
    data:{name,category:'Camisas',variants:[{sku,price_cents:15990,color:'Azul',size:'M'}]}});
  expect(product.ok()).toBeTruthy();
  const variant = (await product.json()).variants[0].id;
  const stock = await request.post('/v1/stock/receipts',{headers:headers(),
    data:{variant_id:variant,reference_id:randomUUID(),quantity:1}});
  expect(stock.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByLabel('Usuário').fill(login.login);
  await page.getByLabel('Senha').fill(login.password);
  await page.getByRole('button',{name:'Entrar na loja'}).click();
  await page.getByRole('button',{name:'Gestão',exact:true}).click();
  await page.getByLabel('Nome',{exact:true}).fill(supplier);
  await page.getByRole('button',{name:'Cadastrar',exact:true}).click();
  await expect(page.getByText(supplier,{exact:true})).toBeVisible();

  await page.getByRole('button',{name:'Cadastrar produtos'}).click();
  await page.getByRole('combobox',{name:'Produto para editar',exact:true}).selectOption({label:name});
  await page.getByRole('combobox',{name:'Variante para preço',exact:true}).selectOption(variant);
  await page.getByRole('button',{name:'Publicar na vitrine'}).click();
  await expect(page.getByText('Variação publicada.')).toBeVisible();
  const storefront = await page.context().newPage();
  await storefront.goto('/vitrine/'+store);
  const item = storefront.getByRole('listitem').filter({hasText:name});
  await expect(item.getByText('Disponível')).toBeVisible();
  await page.getByRole('button',{name:'Reservar',exact:true}).click();
  await expect(page.getByText('Estoque reservado.')).toBeVisible();
  await storefront.reload();
  await expect(item.getByText('Esgotado')).toBeVisible();

  await page.getByRole('button',{name:'Gestão',exact:true}).click();
  await page.getByRole('listitem').filter({hasText:new RegExp(sku,'i')})
    .getByRole('button',{name:'Liberar reserva'}).click();
  await expect(page.getByText('Reserva liberada.')).toBeVisible();
  await storefront.reload();
  await expect(item.getByText('Disponível')).toBeVisible();

  await page.getByRole('button',{name:'Ativar pedidos',exact:true}).click();
  await expect(page.getByText('Pedidos para retirada ativados.')).toBeVisible();
  await storefront.reload();
  await storefront.getByLabel('Quantidade de '+name+' Azul M').fill('1');
  await storefront.getByRole('button',{name:'Enviar pedido para retirada'}).click();
  const code = storefront.locator('.pickup-code');
  await expect(code).toBeVisible();
  const current = await request.get('/v1/cash-sessions/current?terminal=CAIXA-01',{headers:headers()});
  expect(current.ok()).toBeTruthy();
  if (!(await current.json()).active) {
    const opened = await request.post('/v1/cash-sessions',{headers:headers(),
      data:{terminal_code:'CAIXA-01',opening_cents:0}});
    expect(opened.ok()).toBeTruthy();
    await page.reload();
    await page.getByLabel('Usuário').fill(login.login);
    await page.getByLabel('Senha').fill(login.password);
    await page.getByRole('button',{name:'Entrar na loja'}).click();
  }
  await page.getByRole('button',{name:'PDV',exact:true}).click();
  await page.getByLabel('Código de retirada').fill((await code.textContent())!);
  await page.getByRole('button',{name:'Abrir pedido'}).click();
  await page.getByLabel('Dinheiro recebido e conferido').check();
  await page.getByRole('button',{name:'Confirmar venda e pagamentos'}).click();
  const sale = page.getByRole('dialog',{name:'Venda confirmada'});
  await expect(sale).toBeVisible();
  const saleNumber = (await sale.getByRole('heading').textContent())?.match(/#(\d+)/)?.[1];
  expect(saleNumber).toBeTruthy();
  await storefront.reload();
  await expect(item.getByText('Esgotado')).toBeVisible();

  await page.getByRole('button',{name:'Nova venda',exact:true}).click();
  await page.getByRole('button',{name:'Gestão',exact:true}).click();
  await page.getByLabel('Número da venda').fill(saleNumber!);
  await page.getByRole('button',{name:'Localizar venda'}).click();
  await page.getByLabel('Motivo da devolução').fill('Cliente devolveu a peça em condições de venda');
  await page.getByLabel('Conferi todas as peças e autorizo a devolução integral').check();
  await page.getByRole('button',{name:'Registrar devolução',exact:true}).click();
  await expect(page.getByText(/Devolução registrada/)).toBeVisible();
  await storefront.reload();
  await expect(item.getByText('Disponível')).toBeVisible();

  await page.getByRole('combobox',{name:'Fornecedor da compra',exact:true}).selectOption({label:supplier});
  await page.getByLabel('Buscar SKU para compra').fill(sku);
  await page.getByRole('combobox',{name:'Variante da compra',exact:true}).selectOption(variant);
  await page.getByLabel('Quantidade da compra').fill('1');
  await page.getByLabel('Custo unitário (R$)').fill('30,00');
  await page.getByRole('button',{name:'Registrar pedido de compra'}).click();
  const purchase=page.getByRole('listitem').filter({hasText:supplier}).filter({hasText:new RegExp(sku,'i')});
  await purchase.getByRole('button',{name:'Receber compra'}).click();
  await expect(purchase.getByText('Recebido',{exact:true})).toBeVisible();

  await storefront.getByLabel('Quantidade de '+name+' Azul M').fill('1');
  await storefront.getByRole('button',{name:'Enviar pedido para retirada'}).click();
  await expect(code).toBeVisible();
  const pendingCode=(await code.textContent())!;
  await storefront.getByRole('button',{name:'Consultar pedido'}).click();
  await expect(storefront.getByText(/Apresente o código no caixa/)).toBeVisible();
  await page.getByRole('button',{name:'Atualizar filas'}).click();
  await page.getByRole('listitem').filter({hasText:pendingCode})
    .getByRole('button',{name:'Cancelar pedido'}).click();
  await expect(page.getByText('Pedido de retirada cancelado.')).toBeVisible();
  await storefront.getByRole('button',{name:'Consultar pedido'}).click();
  await expect(storefront.getByText('Pedido cancelado pela loja.')).toBeVisible();

  await page.setViewportSize({width:390,height:844});
  await page.getByLabel('Página',{exact:true}).selectOption('pdv');
  await expect(page.getByRole('heading',{name:'Nova venda',exact:true})).toBeVisible();
  await page.getByLabel('Página',{exact:true}).selectOption('gestao');
  await expect(page.getByRole('heading',{name:'Vendas e devoluções nos últimos 30 dias'})).toBeVisible();

});
