import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

test('gestão, publicação e reserva chegam à vitrine', async ({page,request}) => {
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
  await page.getByLabel('Produto para editar').selectOption({label:name});
  await page.getByLabel('Variante para preço').selectOption(variant);
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
});
