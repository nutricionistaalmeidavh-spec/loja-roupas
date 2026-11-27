import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/*
 * Notinha (cupom não fiscal) e atalhos do caixa, no comportamento do PDV Nexus:
 * cupom em colunas por papel, preferências lembradas, impressão automática,
 * segunda via pelo número da venda e F3/F6/F8/Delete no PDV.
 */
const LOGIN = { login: 'qa-admin', password: 'Senha-QA-Somente-CI-2026' };

async function entrar(page: Page) {
  await page.goto('/');
  await page.getByLabel('Usuário').fill(LOGIN.login);
  await page.getByLabel('Senha').fill(LOGIN.password);
  await page.getByRole('button', { name: 'Entrar na loja' }).click();
  await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();
  const tour = page.getByRole('button', { name: 'Pular tour' });
  if (await tour.count()) await tour.click();
}

async function garantirCaixaAberto(page: Page) {
  await page.getByRole('button', { name: 'Caixa', exact: true }).click();
  await expect(page.getByText('Consultando caixa no servidor…')).toBeHidden();
  if (await page.getByRole('button', { name: 'Abrir caixa', exact: true }).count()) {
    await page.getByLabel('Valor inicial (R$)').fill('100,00');
    await page.getByRole('button', { name: 'Abrir caixa', exact: true }).click();
    await expect(page.getByText('Caixa aberto.')).toBeVisible();
  }
}

async function produto(request: APIRequestContext) {
  const session = await request.post('/v1/auth/sessions', { data: LOGIN });
  const { token, stores } = await session.json();
  const headers = () => ({ authorization: 'Bearer ' + token, 'x-store-id': stores[0].store_id as string, 'idempotency-key': randomUUID() });
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const name = 'Vestido Notinha com nome bem comprido ' + tag;
  const created = await request.post('/v1/catalog/products', { headers: headers(),
    data: { name, category: 'Feminino', variants: [{ sku: 'NOT-' + tag, color: 'Areia', size: 'M', price_cents: 18990 }] } });
  expect(created.status()).toBe(201);
  const body = await created.json();
  const receipt = await request.post('/v1/stock/receipts', { headers: headers(),
    data: { variant_id: body.variants[0].id, reference_id: randomUUID(), quantity: 5, note: 'Carga notinha' } });
  expect(receipt.ok()).toBeTruthy();
  return name;
}

test('venda só pelo teclado (F3, F6, F8) gera notinha em colunas, lembra o papel e tem segunda via', async ({ page, request }) => {
  const nome = await produto(request);
  await page.addInitScript(() => { window.print = () => { document.documentElement.dataset.qaPrint = document.documentElement.dataset.receiptPaper ?? 'sem-papel'; }; });
  await entrar(page);
  await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('loja:notinha:')) localStorage.removeItem(key); });
  await garantirCaixaAberto(page);

  await page.keyboard.press('F3');
  await expect(page.locator('#search')).toBeFocused();
  await page.keyboard.type(nome);
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: nome }) });
  await card.getByRole('button', { name: 'Adicionar ' + nome }).click();
  await card.getByRole('button', { name: 'Adicionar ' + nome }).click();
  await expect(page.getByText('2 peças adicionadas')).toBeVisible();
  // Delete fora de campo de texto tira uma unidade do último item.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Delete');
  await expect(page.getByText('1 peça adicionada')).toBeVisible();

  await page.keyboard.press('F6');
  const checkout = page.getByRole('dialog', { name: 'Revisar e finalizar venda' });
  await expect(checkout).toBeVisible();
  await checkout.getByRole('checkbox', { name: 'Dinheiro recebido e conferido' }).check();
  await page.keyboard.press('F8');
  const confirmacao = page.getByRole('dialog', { name: 'Venda confirmada' });
  await expect(confirmacao).toBeVisible();
  const numero = (await confirmacao.getByRole('heading').innerText()).match(/#(\d+)/)![1];

  const cupom = confirmacao.locator('pre.receipt-print');
  await expect(cupom).toContainText('COMPROVANTE NÃO FISCAL');
  await expect(cupom).toContainText(/^TOTAL {2,}R\$\s189,90$/m);
  for (const linha of (await cupom.innerText()).split('\n')) expect(linha.length).toBeLessThanOrEqual(42);

  await confirmacao.getByRole('combobox').selectOption('58');
  await expect(cupom).toContainText(/^TOTAL {2,}R\$\s189,90$/m);
  for (const linha of (await cupom.innerText()).split('\n')) expect(linha.length).toBeLessThanOrEqual(32);
  await confirmacao.getByRole('checkbox', { name: 'Imprimir automaticamente ao finalizar' }).check();
  await confirmacao.getByRole('button', { name: 'Imprimir comprovante não fiscal' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-qa-print', '58');
  await confirmacao.getByRole('button', { name: 'Nova venda' }).click();

  // Segunda via: preferências lembradas (58 mm + automático); só imprime quando pedir.
  await page.evaluate(() => { delete document.documentElement.dataset.qaPrint; });
  await page.getByRole('button', { name: 'Caixa', exact: true }).click();
  await page.getByRole('button', { name: 'Segunda via do cupom' }).click();
  const via = page.getByRole('dialog', { name: 'Segunda via do cupom' });
  await via.getByLabel('Número da venda').fill(numero);
  await via.getByRole('button', { name: 'Buscar venda' }).click();
  await expect(via.locator('pre.receipt-print')).toContainText('Venda Nº ' + numero);
  await expect(via.getByRole('combobox')).toHaveValue('58');
  await expect(via.getByRole('checkbox', { name: 'Imprimir automaticamente ao finalizar' })).toBeChecked();
  await expect(page.locator('html')).not.toHaveAttribute('data-qa-print', /.+/);
  await via.getByRole('button', { name: 'Imprimir comprovante não fiscal' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-qa-print', '58');

  await via.getByLabel('Número da venda').fill('999999999');
  await via.getByRole('button', { name: 'Buscar venda' }).click();
  await expect(via.getByRole('alert')).toHaveText('Venda não encontrada');
  await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('loja:notinha:')) localStorage.removeItem(key); });
});

test('cupom recusa larguras fora de 32, 42 e 90 colunas', async ({ request }) => {
  const session = await request.post('/v1/auth/sessions', { data: LOGIN });
  const { token, stores } = await session.json();
  const headers = { authorization: 'Bearer ' + token, 'x-store-id': stores[0].store_id as string };
  const invalid = await request.get('/v1/sales/' + randomUUID() + '/receipt?cols=50', { headers });
  expect(invalid.status()).toBe(400);
});
