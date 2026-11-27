import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/*
 * Bugs confirmados no teste exploratório com 5 personas (27/11/2026).
 * Relatório: relatorios/qa-personas-2026-11-27 (pasta do projeto).
 *
 * Cada teste descreve o comportamento ESPERADO. Enquanto o bug existir, o teste
 * fica marcado com test.fail(): a suíte continua verde e o Playwright avisa
 * ("expected to fail but passed") assim que a correção chegar. Ao corrigir o
 * bug, remova a linha test.fail() correspondente.
 */

const LOGIN = { login: 'qa-admin', password: 'Senha-QA-Somente-CI-2026' };

async function entrar(page: Page, login = LOGIN.login, password = LOGIN.password) {
  await page.goto('/');
  await page.getByLabel('Usuário').fill(login);
  await page.getByLabel('Senha').fill(password);
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
  } else {
    await expect(page.getByText('Caixa aberto', { exact: true })).toBeVisible();
  }
}

async function api(request: APIRequestContext) {
  const session = await request.post('/v1/auth/sessions', { data: LOGIN });
  expect(session.ok()).toBeTruthy();
  const { token, stores } = await session.json();
  const store = stores[0].store_id as string;
  const headers = () => ({ authorization: 'Bearer ' + token, 'x-store-id': store, 'idempotency-key': randomUUID() });
  return { headers };
}

/** Cria produto com uma ou mais variantes e dá entrada de estoque via API. */
async function produtoComEstoque(request: APIRequestContext, nome: string,
  variantes: Array<{ size: string; quantity: number; price_cents?: number }>) {
  const { headers } = await api(request);
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const created = await request.post('/v1/catalog/products', {
    headers: headers(),
    data: {
      name: nome + ' ' + tag, category: 'Feminino',
      variants: variantes.map(v => ({ sku: 'QA5P-' + tag + '-' + v.size, color: 'Bege', size: v.size, price_cents: v.price_cents ?? 10000 })),
    },
  });
  expect(created.status()).toBe(201);
  const body = await created.json();
  for (const [i, v] of variantes.entries()) {
    if (!v.quantity) continue;
    const receipt = await request.post('/v1/stock/receipts', {
      headers: headers(),
      data: { variant_id: body.variants[i].id, reference_id: randomUUID(), quantity: v.quantity, note: 'Carga QA personas' },
    });
    expect(receipt.ok()).toBeTruthy();
  }
  return { name: nome + ' ' + tag, skus: variantes.map(v => 'QA5P-' + tag + '-' + v.size) };
}

async function adicionarAoCarrinho(page: Page, nome: string, tamanho?: string) {
  await page.getByRole('button', { name: 'PDV' }).click();
  await page.getByLabel('Buscar nome, SKU ou código').fill(nome);
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: nome }) });
  await expect(card).toBeVisible();
  if (tamanho) await card.getByRole('button', { name: tamanho, exact: true }).click();
  const cor = card.getByRole('button', { name: 'Selecionar cor Bege' });
  if ((await cor.getAttribute('aria-pressed')) !== 'true') await cor.click();
  await card.getByRole('button', { name: 'Adicionar ' + nome }).click();
}

test.describe('Persona caixa novato', () => {
  test('P1: valor com ponto na sangria não pode travar o caixa até recarregar a página', async ({ page }) => {
    test.fail(true, 'Bug P1-01: CashPanel guarda a chave de idempotência quando a validação local falha.');
    await entrar(page);
    await garantirCaixaAberto(page);
    await page.getByRole('button', { name: 'Sangria ou suprimento' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Sangria ou suprimento' });
    await dialogo.getByLabel('Tipo').selectOption('supply');
    await dialogo.getByLabel('Justificativa').fill('Troco para o dia QA');
    await dialogo.getByLabel('Valor (R$)').fill('5.00');
    await dialogo.getByRole('button', { name: 'Registrar movimento' }).click();
    await expect(dialogo.getByRole('alert')).toBeVisible();
    // A caixa corrige o valor para o formato aceito: deve funcionar.
    await dialogo.getByLabel('Valor (R$)').fill('5,00');
    await dialogo.getByRole('button', { name: 'Registrar movimento' }).click();
    await expect(page.getByText('Existe uma operação pendente. Repita sem alterar os campos.')).toHaveCount(0);
    await expect(page.getByText('Movimento de caixa registrado.')).toBeVisible();
  });

  test('P2: caixa aberto por outro operador explica o que fazer, sem erro técnico', async ({ page, request }) => {
    test.fail(true, 'Bug P2-06: mostra o formulário de abertura e responde "Conflito de integridade ou duplicidade".');
    const { headers } = await api(request);
    const login = 'qa.caixa.' + randomUUID().slice(0, 6);
    const password = 'Senha-Caixa-QA-2026';
    const user = await request.post('/v1/management/users', {
      headers: headers(), data: { login, display_name: 'Caixa QA', password, roles: ['cashier'] },
    });
    expect(user.status()).toBe(201);
    await entrar(page);
    await garantirCaixaAberto(page);
    await page.getByRole('button', { name: 'Sair' }).click();
    await entrar(page, login, password);
    await page.getByRole('button', { name: 'Caixa', exact: true }).click();
    await expect(page.getByText('Este caixa pertence a outro operador')).toBeVisible();
    if (await page.getByRole('button', { name: 'Abrir caixa', exact: true }).count()) {
      await page.getByLabel('Valor inicial (R$)').fill('50,00');
      const resposta = page.waitForResponse(r => r.url().endsWith('/v1/cash-sessions') && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Abrir caixa', exact: true }).click();
      await resposta;
    }
    await expect(page.getByText('Conflito de integridade ou duplicidade')).toHaveCount(0);
  });
});

test('P3: divergência no fechamento do caixa mostra o aviso uma vez só', async ({ page }) => {
  test.fail(true, 'Bug P3-11: o alerta aparece no diálogo e também na página.');
  await entrar(page);
  await garantirCaixaAberto(page);
  await page.getByRole('button', { name: 'Fechar caixa' }).click();
  const dialogo = page.getByRole('dialog', { name: 'Fechar caixa' });
  await dialogo.getByLabel('Dinheiro contado (R$)').fill('1,00');
  await dialogo.getByRole('button', { name: 'Fechar e conferir caixa' }).click();
  await expect(page.getByText('Justifique divergência de caixa com ao menos 8 caracteres').first()).toBeVisible();
  await expect(page.getByText('Justifique divergência de caixa com ao menos 8 caracteres')).toHaveCount(1);
});

test('P3: o app tem ícone (favicon) e não gera erro 404 no console', async ({ request }) => {
  test.fail(true, 'Bug P3-12: /favicon.ico responde 404.');
  const icone = await request.get('/favicon.ico');
  expect(icone.status()).toBe(200);
});

test.describe('Persona operador que fecha o app no meio da venda', () => {
  test('P1: depois de queda de rede e reabertura, o carrinho já vendido não volta como venda nova', async ({ page, request }) => {
    test.fail(true, 'Bug P1-02: "Recuperar carrinho" aparece sem aviso e permite vender de novo o mesmo carrinho.');
    const produto = await produtoComEstoque(request, 'Blusa Queda QA', [{ size: 'M', quantity: 4 }]);
    await entrar(page);
    await garantirCaixaAberto(page);
    await adicionarAoCarrinho(page, produto.name);
    await page.getByRole('button', { name: 'Revisar e pagar' }).click();
    const checkout = page.getByRole('dialog', { name: 'Revisar e finalizar venda' });
    await checkout.getByRole('checkbox', { name: 'Dinheiro recebido e conferido' }).check();
    // O servidor grava a venda, mas a resposta não chega (rede LAN caiu).
    await page.route('**/v1/sales', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const resposta = await route.fetch();
      expect(resposta.status()).toBe(201);
      await route.abort('connectionreset');
    });
    await checkout.getByRole('button', { name: /Confirmar venda/ }).click();
    await expect(checkout.getByText(/A operação pode ter sido gravada/)).toBeVisible();
    await page.unroute('**/v1/sales');
    // Operador fecha/recarrega o app.
    page.on('dialog', dialog => void dialog.accept());
    await page.reload();
    await entrar(page);
    await page.getByRole('button', { name: 'PDV' }).click();
    const recuperar = page.getByRole('button', { name: 'Recuperar carrinho' });
    // Esperado: não oferecer o carrinho como venda nova, ou avisar que a venda pode já estar registrada.
    if (await recuperar.count()) {
      await expect(page.getByText(/pode já ter sido (registrada|gravada)|confira a última venda/i)).toBeVisible();
    }
  });
});

test.describe('Persona gerente que mexe em tudo', () => {
  test('P2: preço com separador de milhar (1.234,56) é aceito no cadastro', async ({ page }) => {
    test.fail(true, 'Bug P2-05: reaisToCents só aceita dígitos com vírgula, sem ponto de milhar.');
    const sku = 'QA5P-MIL-' + randomUUID().slice(0, 6).toUpperCase();
    await entrar(page);
    await page.getByRole('button', { name: 'Cadastrar produtos' }).click();
    await page.getByRole('button', { name: /Novo produto/ }).click();
    await page.getByLabel('Nome da peça').fill('Casaco Milhar ' + sku);
    await page.getByLabel('SKU').fill(sku);
    await page.getByLabel('Cor').fill('Preto');
    await page.getByLabel('Tamanho').fill('M');
    await page.getByLabel('Preço (R$)').fill('1.234,56');
    await page.getByRole('button', { name: 'Cadastrar produto', exact: true }).click();
    await expect(page.getByText(/Produto cadastrado:/)).toBeVisible();
  });

  test('P3: preço zero explica o motivo em vez de "Formato de entrada inválido"', async ({ page }) => {
    test.fail(true, 'Bug P3-08: a API recusa price_cents 0 com mensagem genérica.');
    const sku = 'QA5P-ZERO-' + randomUUID().slice(0, 6).toUpperCase();
    await entrar(page);
    await page.getByRole('button', { name: 'Cadastrar produtos' }).click();
    await page.getByRole('button', { name: /Novo produto/ }).click();
    await page.getByLabel('Nome da peça').fill('Brinde ' + sku);
    await page.getByLabel('SKU').fill(sku);
    await page.getByLabel('Cor').fill('Preto');
    await page.getByLabel('Tamanho').fill('U');
    await page.getByLabel('Preço (R$)').fill('0,00');
    await page.getByRole('button', { name: 'Cadastrar produto', exact: true }).click();
    const alerta = page.getByRole('dialog', { name: 'Novo produto' }).getByRole('alert');
    await expect(alerta).toBeVisible();
    await expect(alerta).not.toHaveText('Formato de entrada inválido');
    await expect(alerta).toContainText(/preço/i);
  });

  test('P3: tamanhos aparecem na ordem da grade (P antes de G)', async ({ page, request }) => {
    test.fail(true, 'Bug P3-10: tamanhos ordenados alfabeticamente.');
    const produto = await produtoComEstoque(request, 'Vestido Grade QA', [{ size: 'G', quantity: 1 }, { size: 'P', quantity: 1 }]);
    await entrar(page);
    await page.getByLabel('Buscar nome, SKU ou código').fill(produto.name);
    const tamanhos = page.getByRole('group', { name: 'Tamanhos de ' + produto.name }).getByRole('button');
    await expect(tamanhos).toHaveText(['P', 'G']);
  });

  test('P2: backup em terminal sem banco local mostra orientação, não erro técnico do Electron', async ({ page }) => {
    test.fail(true, 'Bug P2-04: em terminal LAN (ou fora do Windows) o preload expõe lojaBackups sem handlers registrados.');
    await page.addInitScript(() => {
      const falha = (canal: string) => () => Promise.reject(new Error(
        `Error invoking remote method '${canal}': Error: No handler registered for '${canal}'`));
      (window as unknown as Record<string, unknown>).lojaBackups = {
        create: falha('loja:backup:create'), verify: falha('loja:backup:verify'),
        autoStatus: falha('loja:backup:auto-status'), autoFolder: falha('loja:backup:auto-folder'),
        autoRun: falha('loja:backup:auto-run'), restore: falha('loja:backup:restore'),
      };
    });
    await entrar(page);
    await page.getByRole('button', { name: 'Configurações' }).click();
    await page.getByRole('button', { name: 'Fazer backup agora' }).click();
    const regiao = page.getByRole('region', { name: 'Backup local da loja' });
    await expect(regiao.getByText(/No handler registered|Error invoking remote method/)).toHaveCount(0);
  });
});

test.describe('Persona vendedora apressada', () => {
  test('P3: erro de desconto inválido aparece perto do campo, sem precisar rolar', async ({ page, request }) => {
    test.fail(true, 'Bug P3-07: o alerta fica no fim do diálogo, fora da área visível.');
    const produto = await produtoComEstoque(request, 'Saia Desconto QA', [{ size: 'M', quantity: 2 }]);
    await entrar(page);
    await garantirCaixaAberto(page);
    await adicionarAoCarrinho(page, produto.name);
    await page.getByRole('button', { name: 'Revisar e pagar' }).click();
    const checkout = page.getByRole('dialog', { name: 'Revisar e finalizar venda' });
    await checkout.getByRole('textbox', { name: 'Valor do desconto' }).fill('150');
    await checkout.getByRole('combobox', { name: 'Tipo de desconto' }).selectOption('%');
    await checkout.getByRole('textbox', { name: 'Motivo do desconto' }).fill('teste persona');
    await checkout.getByRole('button', { name: 'Aplicar' }).click();
    await expect(checkout.getByText('Percentual de desconto inválido.')).toBeInViewport();
  });

  test('P3: Pix acima do total não mostra troco', async ({ page, request }) => {
    test.fail(true, 'Bug P3-09: o resumo calcula troco para qualquer forma de pagamento.');
    const produto = await produtoComEstoque(request, 'Calça Pix QA', [{ size: 'M', quantity: 2 }]);
    await entrar(page);
    await garantirCaixaAberto(page);
    await adicionarAoCarrinho(page, produto.name);
    await page.getByRole('button', { name: 'Revisar e pagar' }).click();
    const checkout = page.getByRole('dialog', { name: 'Revisar e finalizar venda' });
    await checkout.getByRole('combobox', { name: 'Método pagamento 1' }).selectOption({ label: 'Pix conferido manualmente' });
    await checkout.getByRole('textbox', { name: 'Valor pagamento 1' }).fill('500,00');
    const troco = checkout.locator('.total-row').filter({ hasText: 'Troco' });
    await expect(troco).toContainText('R$ 0,00');
  });
});
