import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/*
 * Achados da avaliação dev/UX/produto: checkout em uma tela, Pix com QR Code,
 * condicional (malinha), promoção automática, relatórios de moda e aniversariantes.
 */
const LOGIN = { login: 'qa-admin', password: 'Senha-QA-Somente-CI-2026' };

async function api(request: APIRequestContext) {
  const session = await (await request.post('/v1/auth/sessions', { data: LOGIN })).json();
  const headers = () => ({ authorization: 'Bearer ' + session.token, 'x-store-id': session.stores[0].store_id as string, 'idempotency-key': randomUUID() });
  return { headers };
}
async function produto(request: APIRequestContext, categoria: string) {
  const { headers } = await api(request);
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const name = 'Blusa Extras ' + tag;
  const created = await request.post('/v1/catalog/products', { headers: headers(),
    data: { name, category: categoria, variants: [{ sku: 'BX-' + tag, color: 'Preta', size: 'M', price_cents: 5000 }] } });
  expect(created.status()).toBe(201);
  const body = await created.json();
  expect((await request.post('/v1/stock/receipts', { headers: headers(),
    data: { variant_id: body.variants[0].id, reference_id: randomUUID(), quantity: 6, note: 'Carga extras' } })).ok()).toBeTruthy();
  return name;
}
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
  await expect(page.getByText('Consultando caixa…')).toBeHidden();
  if (await page.getByRole('button', { name: 'Abrir caixa', exact: true }).count()) {
    await page.getByLabel('Valor inicial (R$)').fill('100,00');
    await page.getByRole('button', { name: 'Abrir caixa', exact: true }).click();
    await expect(page.getByText('Caixa aberto.')).toBeVisible();
  }
  await expect(page.getByText('Deveria ter na gaveta agora')).toBeVisible();
}
async function adicionar(page: Page, nome: string, vezes = 1) {
  await page.getByRole('button', { name: 'PDV', exact: true }).click();
  await page.locator('#search').fill(nome);
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: nome }) });
  for (let i = 0; i < vezes; i++) await card.getByRole('button', { name: 'Adicionar ' + nome }).click();
}

test('promoção leve 2 pague 1 entra sozinha e o pagamento aparece sem rolar, com QR Code do Pix', async ({ page, request }) => {
  const categoria = 'Promo ' + randomUUID().slice(0, 6);
  const nome = await produto(request, categoria);
  const { headers } = await api(request);
  const hoje = new Date().toISOString().slice(0, 10);
  expect((await request.post('/v1/promotions', { headers: headers(), data: { name: 'Leve 2 pague 1 QA', kind: 'buy_x_pay_y', category: categoria, buy_quantity: 2, pay_quantity: 1, starts_on: hoje, ends_on: hoje } })).status()).toBe(201);
  const perfil = await (await request.get('/v1/management/store-profile', { headers: headers() })).json();
  expect((await request.put('/v1/management/store-profile', { headers: headers(), data: { name: perfil.name, max_cashier_discount_bps: perfil.max_cashier_discount_bps, pix_key: 'qa@loja.com.br', pix_city: 'São Paulo' } })).ok()).toBeTruthy();

  await page.setViewportSize({ width: 1366, height: 768 });
  await entrar(page);
  await garantirCaixaAberto(page);
  await adicionar(page, nome, 2);
  await page.getByRole('button', { name: 'Revisar e pagar' }).click();
  const checkout = page.getByRole('dialog', { name: 'Revisar e finalizar venda' });
  await expect(checkout.getByText('Promoção (Leve 2 pague 1 QA)')).toBeVisible();
  await expect(checkout.locator('.checkout-grand-total')).toContainText('R$ 50,00');
  await expect(checkout.getByRole('combobox', { name: 'Método pagamento 1' })).toBeInViewport();
  await expect(checkout.getByRole('button', { name: 'Confirmar venda e pagamentos' })).toBeInViewport();
  await checkout.getByRole('combobox', { name: 'Método pagamento 1' }).selectOption({ label: 'Pix' });
  await expect(checkout.getByRole('img', { name: /QR Code Pix de R\$\s50,00/ })).toBeVisible();
  await checkout.getByRole('textbox', { name: 'Referência pagamento 1' }).fill('E2E-PIX-QA');
  await checkout.getByRole('checkbox', { name: 'Pagamento confirmado fora deste sistema e conferido' }).check();
  await checkout.getByRole('button', { name: 'Confirmar venda e pagamentos' }).click();
  const confirmacao = page.getByRole('dialog', { name: 'Venda confirmada' });
  await expect(confirmacao.locator('pre.receipt-print')).toContainText('Promoção: Leve 2 pague 1 QA');
  await confirmacao.getByRole('checkbox', { name: 'Vale-troca (sem preços, para presente)' }).check();
  await expect(confirmacao.locator('pre.receipt-print')).toContainText('VALE-TROCA');
  await expect(confirmacao.locator('pre.receipt-print')).not.toContainText('R$');
  await confirmacao.getByRole('button', { name: 'Nova venda' }).click();
});

test('condicional: cliente leva peças, devolve uma e a outra vai para o carrinho', async ({ page, request }) => {
  const nome = await produto(request, 'Condicional');
  const { headers } = await api(request);
  const cliente = 'Cliente Malinha ' + randomUUID().slice(0, 6);
  expect((await request.post('/v1/management/customers', { headers: headers(), data: { name: cliente } })).status()).toBe(201);
  await entrar(page);
  await garantirCaixaAberto(page);
  await adicionar(page, nome, 2);
  await page.getByRole('button', { name: 'Levar como condicional' }).click();
  const abrir = page.getByRole('dialog', { name: 'Levar como condicional' });
  await abrir.getByLabel('Buscar cliente').fill(cliente);
  await abrir.getByLabel('Cliente do condicional').selectOption({ label: cliente });
  await abrir.getByRole('button', { name: 'Abrir condicional' }).click();
  await expect(page.getByText(/Condicional \d+ aberto/).first()).toBeVisible();
  await expect(page.getByText('0 peças adicionadas')).toBeVisible();

  await page.getByRole('button', { name: 'Condicionais abertos' }).click();
  const lista = page.getByRole('dialog', { name: 'Condicionais abertos' });
  const linha = lista.getByRole('row').filter({ hasText: cliente });
  await linha.getByRole('button', { name: /Fechar condicional/ }).click();
  await lista.getByRole('spinbutton', { name: /Ficou com/ }).fill('1');
  await lista.getByRole('button', { name: 'Fechar e levar ao caixa' }).click();
  await expect(page.getByText('1 peça adicionada')).toBeVisible();
  await expect(page.getByText('Peças do condicional no carrinho. Confira e finalize a venda.').first()).toBeVisible();
});

test('gestão em grupos: relatórios de moda e aniversariantes com WhatsApp', async ({ page, request }) => {
  const { headers } = await api(request);
  const mes = String(new Date().getMonth() + 1).padStart(2, '0');
  const cliente = 'Aniversariante ' + randomUUID().slice(0, 6);
  const telefone = '119' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  expect((await request.post('/v1/management/customers', { headers: headers(), data: { name: cliente, phone: telefone, marketing_consent: true, birth_date: '1991-' + mes + '-02' } })).status()).toBe(201);
  await entrar(page);
  await page.getByRole('button', { name: 'Gestão', exact: true }).click();
  const grupos = page.getByRole('navigation', { name: 'Atalhos da gestão' });
  for (const nome of ['Vendas', 'Estoque e compras', 'Clientes e trocas', 'Dinheiro', 'Pessoas e loja']) await expect(grupos.getByRole('link', { name: nome, exact: true })).toBeVisible();
  expect(await grupos.getByRole('link').count()).toBeLessThanOrEqual(6);
  await page.getByRole('link', { name: 'Relatórios de moda' }).click();
  await expect(page.getByRole('heading', { name: 'Curva ABC' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Giro por grade' })).toBeVisible();
  await grupos.getByRole('link', { name: 'Clientes e trocas' }).click();
  await page.getByRole('link', { name: 'Aniversariantes' }).click();
  const item = page.getByRole('listitem').filter({ hasText: cliente });
  await expect(item.getByRole('link', { name: 'Mandar parabéns no WhatsApp' })).toHaveAttribute('href', new RegExp('^https://wa\\.me/55' + telefone + '\\?text='));
});
