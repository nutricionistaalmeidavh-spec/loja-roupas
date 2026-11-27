// Teste exploratório das 5 personas no aplicativo desktop INSTALADO (edição comercial, Windows).
// Não usa a Central ArtiSys: a licença é pré-gravada como ativa e o host da Central é
// bloqueado no runner, simulando um computador licenciado sem internet (carência de 30 dias).
// Cada cenário registra resultado e screenshots em LOJA_QA_OUT (artefato do workflow).
import { mkdtemp, mkdir, writeFile, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';

const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { _electron: electron } = require('@playwright/test');

const executablePath = process.argv[2];
if (!executablePath || !path.isAbsolute(executablePath)) throw Error('Electron absoluto obrigatório');
const out = process.env.LOJA_QA_OUT || path.join(tmpdir(), 'qa-personas-desktop');
await mkdir(out, { recursive: true });
const userData = await mkdtemp(path.join(tmpdir(), 'loja-qa-personas-'));
const work = await mkdtemp(path.join(tmpdir(), 'loja-qa-arquivos-'));
const ADMIN = { login: 'gerente.qa', password: 'Gerente-' + randomUUID() };
const results = [];
let shot = 0;
let app, win, origin, token, storeId;

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function snap(name) {
  if (!win || win.isClosed()) return;
  const file = String(++shot).padStart(2, '0') + '-' + name + '.png';
  await win.screenshot({ path: path.join(out, file) }).catch(() => {});
}
async function scenario(id, persona, title, fn) {
  const started = Date.now();
  const record = { id, persona, title, status: 'ok', notes: [] };
  const note = text => { record.notes.push(text); console.info(`[${id}] ${text}`); };
  try {
    await fn(note);
  } catch (error) {
    record.status = 'erro';
    record.notes.push('ERRO: ' + (error?.message || String(error)).split('\n')[0]);
    console.error(`[${id}]`, error);
    await snap(id + '-erro');
  }
  record.seconds = Math.round((Date.now() - started) / 1000);
  results.push(record);
  await writeFile(path.join(out, 'resultados.json'), JSON.stringify(results, null, 1));
}
function finding(note, gravidade, texto) { note(`ACHADO ${gravidade}: ${texto}`); }

async function seedLicense() {
  await writeFile(path.join(userData, 'commercial-license.json'), JSON.stringify({
    installationId: 'loja-' + randomUUID(), licenseId: 'qa-offline-ci', accountEmail: 'qa@example.invalid',
    active: true, expiresAt: null, checkedAt: Date.now(),
  }));
}
async function launch() {
  const env = { ...process.env };
  delete env.LOJA_SERVER_URL;
  app = await electron.launch({ executablePath, args: ['--user-data-dir=' + userData], chromiumSandbox: true, env, timeout: 60_000 });
  return app;
}
async function mainWindow(timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const found = app.windows().find(w => w.url().startsWith('http://127.0.0.1:'));
    if (found) {
      win = found;
      origin = new URL(found.url()).origin;
      await win.setViewportSize({ width: 1366, height: 820 }).catch(() => {});
      await win.addLocatorHandler(win.getByRole('dialog', { name: 'Atualização da loja' }), async m => {
        await m.getByRole('button', { name: 'Agora não' }).click();
      }).catch(() => {});
      return win;
    }
    await sleep(400);
  }
  throw Error('Janela principal não abriu');
}
async function login(user = ADMIN) {
  await win.getByRole('heading', { name: 'Bem-vindo à sua loja' }).waitFor({ timeout: 60_000 });
  await win.getByLabel('Usuário').fill(user.login);
  await win.getByLabel('Senha').fill(user.password);
  await win.getByRole('button', { name: 'Entrar na loja' }).click();
  await win.getByRole('button', { name: 'Sair' }).waitFor({ timeout: 20_000 });
  const skip = win.getByRole('button', { name: 'Pular tour' });
  await skip.waitFor({ timeout: 4000 }).catch(() => {});
  if (await skip.isVisible().catch(() => false)) await skip.click();
}
async function apiLogin() {
  const r = await fetch(origin + '/v1/auth/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ADMIN) });
  const body = await r.json();
  token = body.token; storeId = body.stores[0].store_id;
}
async function api(method, route, data) {
  const r = await fetch(origin + route, {
    method, headers: { authorization: 'Bearer ' + token, 'x-store-id': storeId, 'idempotency-key': randomUUID(), ...(data ? { 'content-type': 'application/json' } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  });
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; } catch { return { status: r.status, body: text }; }
}
async function variants(q) {
  const r = await api('GET', '/v1/catalog/products?query=' + encodeURIComponent(q));
  return (r.body?.items ?? []).flatMap(p => p.variants);
}
async function stockOf(sku) { return (await variants(sku)).find(v => v.sku === sku)?.available ?? null; }
async function salesCount() {
  const r = await api('GET', '/v1/management/sales-summary');
  return (r.body?.days ?? []).reduce((n, d) => n + Number(d.sale_count), 0);
}
async function openCash(value = '100,00') {
  await win.getByRole('button', { name: 'Caixa', exact: true }).click();
  await win.getByText('Consultando caixa no servidor…').waitFor({ state: 'hidden' }).catch(() => {});
  if (await win.getByRole('button', { name: 'Abrir caixa', exact: true }).count()) {
    await win.getByLabel('Valor inicial (R$)').fill(value);
    await win.getByRole('button', { name: 'Abrir caixa', exact: true }).click();
    await win.getByText('Caixa aberto.').waitFor({ timeout: 10_000 });
  }
}
async function addToCart(name, size) {
  await win.getByRole('button', { name: 'PDV', exact: true }).click();
  await win.getByLabel('Buscar nome, SKU ou código').fill(name);
  const card = win.getByRole('article').filter({ has: win.getByRole('heading', { name }) });
  await card.waitFor({ timeout: 15_000 });
  if (size) await card.getByRole('button', { name: size, exact: true }).click();
  const cor = card.getByRole('button', { name: /Selecionar cor/ }).first();
  if ((await cor.getAttribute('aria-pressed')) !== 'true') await cor.click();
  await card.getByRole('button', { name: 'Adicionar ' + name }).click();
}
async function checkoutCash() {
  await win.getByRole('button', { name: 'Revisar e pagar' }).click();
  const d = win.getByRole('dialog', { name: 'Revisar e finalizar venda' });
  await d.getByRole('checkbox', { name: 'Dinheiro recebido e conferido' }).check();
  return d;
}
async function windowsOpen() { return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length).catch(() => 0); }
function killTree() {
  try { execSync('taskkill /F /T /IM electron.exe', { stdio: 'ignore' }); } catch {}
}
async function relaunch(note, reason) {
  note('Reabrindo o aplicativo: ' + reason);
  await launch();
  await mainWindow();
  await login();
  await apiLogin();
}

const PRODUCT = 'Vestido QA Desktop';
const SKU_P = 'QAD-VES-P', SKU_G = 'QAD-VES-G';

try {
  await seedLicense();

  await scenario('S01', 'Gerente', 'Primeira abertura: preparar banco, criar loja e entrar', async note => {
    await launch();
    const setup = await app.firstWindow({ timeout: 30_000 });
    win = setup;
    const t0 = Date.now();
    await setup.getByRole('heading', { name: 'Crie sua loja' }).waitFor({ timeout: 180_000 });
    note(`Assistente pronto em ${Math.round((Date.now() - t0) / 1000)} s (licença ativa offline, Central bloqueada)`);
    await snap('setup-crie-sua-loja');
    await setup.locator('input[name=password]').fill('curta');
    await setup.locator('input[name=name]').fill('Boutique QA Desktop');
    await setup.locator('input[name=login]').fill(ADMIN.login);
    await setup.getByRole('button', { name: 'Criar loja e começar' }).click();
    await sleep(800);
    note('Senha curta: ' + ((await setup.locator('input[name=password]').evaluate(e => e.validationMessage)) || 'aceita sem aviso'));
    await setup.locator('input[name=password]').fill(ADMIN.password);
    await setup.getByRole('button', { name: 'Criar loja e começar' }).dblclick();
    await mainWindow();
    await snap('login');
    await login();
    await apiLogin();
    await snap('pdv-vazio');
  });

  await scenario('S02', 'Gerente', 'Cadastro com grade, preço com milhar e entrada de estoque', async note => {
    await win.getByRole('button', { name: 'Cadastrar produtos' }).click();
    await win.getByRole('button', { name: /Novo produto/ }).click();
    const d = win.getByRole('dialog', { name: 'Novo produto' });
    await d.getByLabel('Nome da peça').fill('Casaco Milhar QA');
    await d.getByLabel('SKU').fill('QAD-CAS-M');
    await d.getByLabel('Cor').fill('Preto'); await d.getByLabel('Tamanho').fill('M');
    await d.getByLabel('Preço (R$)').fill('1.234,56');
    await d.getByRole('button', { name: 'Cadastrar produto', exact: true }).click();
    await sleep(1200);
    const alert = (await d.getByRole('alert').allInnerTexts()).join(' / ');
    if (alert) finding(note, 'P2', 'preço "1.234,56" recusado no desktop: ' + alert);
    await snap('preco-milhar');
    await d.getByLabel('Nome da peça').fill(PRODUCT);
    await d.getByRole('button', { name: '+ Adicionar cor/tamanho' }).click();
    for (const [i, sku, size] of [[1, SKU_G, 'G'], [2, SKU_P, 'P']]) {
      const g = d.getByRole('group', { name: 'Variante ' + i });
      await g.getByLabel('SKU').fill(sku); await g.getByLabel('Cor').fill('Bege');
      await g.getByLabel('Tamanho').fill(size); await g.getByLabel('Preço (R$)').fill('150,00');
    }
    await d.getByRole('button', { name: 'Cadastrar produto', exact: true }).click();
    await win.getByText(/Produto cadastrado:/).waitFor({ timeout: 10_000 });
    await d.getByRole('button', { name: /Fechar/ }).first().click();
    const ids = Object.fromEntries((await variants('QAD-VES')).map(v => [v.sku, v.id]));
    for (const [sku, q] of [[SKU_P, 3], [SKU_G, 1]]) {
      const r = await api('POST', '/v1/stock/receipts', { variant_id: ids[sku], reference_id: randomUUID(), quantity: q, note: 'Carga QA desktop' });
      note(`Entrada ${sku} x${q}: HTTP ${r.status}`);
    }
    await win.getByRole('button', { name: 'PDV', exact: true }).click();
    await win.getByLabel('Buscar nome, SKU ou código').fill(PRODUCT);
    const order = await win.getByRole('group', { name: 'Tamanhos de ' + PRODUCT }).getByRole('button').allInnerTexts();
    note('Ordem dos tamanhos no PDV: ' + order.join(', '));
    if (order[0] === 'G') finding(note, 'P3', 'tamanhos em ordem alfabética (G antes de P)');
    await snap('pdv-tamanhos');
  });

  await scenario('S03', 'Caixa novato', 'Abrir caixa digitando "100,000" e depois corrigir para "100.00"', async note => {
    await win.getByRole('button', { name: 'Caixa', exact: true }).click();
    await win.getByText('Consultando caixa no servidor…').waitFor({ state: 'hidden' }).catch(() => {});
    await win.getByLabel('Valor inicial (R$)').fill('100,000');
    await win.getByRole('button', { name: 'Abrir caixa', exact: true }).click();
    await sleep(800);
    note('Com "100,000": ' + (await win.getByRole('alert').allInnerTexts()).join(' / '));
    // Corrige usando ponto decimal, como vem do teclado numérico.
    await win.getByLabel('Valor inicial (R$)').fill('100.00');
    await win.getByRole('button', { name: 'Abrir caixa', exact: true }).click();
    await sleep(1200);
    await snap('caixa-apos-corrigir');
    if (await win.getByText('Existe uma operação pendente').count()) {
      finding(note, 'P1', 'caixa travado no desktop instalado depois de corrigir o valor');
      await win.keyboard.press('Control+R');
      await sleep(2500);
      const reloaded = await win.getByRole('heading', { name: 'Bem-vindo à sua loja' }).isVisible().catch(() => false);
      note('Ctrl+R recarrega o app? ' + (reloaded ? 'sim (volta ao login)' : 'não'));
      await win.keyboard.press('F5'); await sleep(2500);
      const f5 = await win.getByRole('heading', { name: 'Bem-vindo à sua loja' }).isVisible().catch(() => false);
      note('F5 recarrega o app? ' + (f5 ? 'sim' : 'não'));
      if (reloaded || f5) await login();
      else { await app.close().catch(() => {}); killTree(); await sleep(3000); await relaunch(note, 'única saída para destravar o caixa'); }
    } else note('Caixa abriu normalmente após corrigir');
    await openCash();
    await snap('caixa-aberto');
  });

  await scenario('S04', 'Vendedora apressada', 'Venda com duplo clique em Adicionar e Confirmar', async note => {
    const before = await salesCount();
    await addToCart(PRODUCT, 'P');
    const card = win.getByRole('article').filter({ has: win.getByRole('heading', { name: PRODUCT }) });
    await card.getByRole('button', { name: 'Adicionar ' + PRODUCT }).dblclick();
    await card.getByRole('button', { name: 'Adicionar ' + PRODUCT }).dblclick();
    note('Carrinho: ' + (await win.getByRole('complementary', { name: 'Carrinho da venda' }).innerText()).split('\n').slice(0, 6).join(' | '));
    const d = await checkoutCash();
    await d.getByRole('button', { name: /Confirmar venda/ }).dblclick();
    await win.getByText(/Venda #\d+ confirmada/).waitFor({ timeout: 15_000 });
    await snap('venda-confirmada');
    const after = await salesCount();
    note(`Vendas antes/depois: ${before} → ${after}`);
    if (after - before !== 1) finding(note, 'P1', `duplo clique gerou ${after - before} vendas`);
    note('Estoque P depois de vender: ' + await stockOf(SKU_P));
    await win.getByRole('button', { name: 'Nova venda' }).click();
  });

  await scenario('S05', 'Operador que fecha o app', 'Clicar no X com peça no carrinho', async note => {
    await addToCart(PRODUCT, 'G');
    await snap('carrinho-antes-de-fechar');
    // A pergunta nativa é síncrona: troca por um registro para o roteiro não ficar preso nela.
    const closeWithAnswer = answer => app.evaluate(({ BrowserWindow, dialog }, choice) => {
      globalThis.__qaClosePrompt = null;
      dialog.showMessageBoxSync = (_w, options) => { globalThis.__qaClosePrompt = options?.message ?? ''; return choice; };
      BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('http'))?.close();
    }, answer);
    await closeWithAnswer(0);
    await sleep(2000);
    const prompt = await app.evaluate(() => globalThis.__qaClosePrompt).catch(() => null);
    const open = await windowsOpen();
    note('Pergunta ao clicar no X: ' + (prompt ?? 'nenhuma'));
    note('Escolhendo "Continuar vendendo", janelas abertas: ' + open);
    if (!prompt) finding(note, 'P2', 'com peça no carrinho, o X não fecha o app e não mostra aviso');
    await snap('depois-do-x');
    if (prompt && open > 0) {
      await closeWithAnswer(1).catch(() => {});
      await sleep(4000);
      const after = await windowsOpen();
      note('Escolhendo "Fechar mesmo assim", janelas abertas: ' + after);
      if (after > 0) finding(note, 'P2', '"Fechar mesmo assim" não fechou o app');
    }
  });

  await scenario('S06', 'Operador que fecha o app', 'App encerrado à força no meio da venda (queda de energia)', async note => {
    if (await windowsOpen() === 0) await relaunch(note, 'o X fechou o app no cenário anterior');
    else if (!win || win.isClosed()) await mainWindow();
    // Se o X fechou o app, o carrinho voltou vazio: coloca a peça G de novo (sem estoque extra, o catch cobre o caso em que ela ainda está lá).
    await addToCart(PRODUCT, 'G').catch(() => {});
    const salesBefore = await salesCount();
    const d = await checkoutCash();
    await win.route('**/v1/sales', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const r = await route.fetch();
      note('Servidor respondeu ' + r.status() + ' à venda; o app é morto antes de mostrar o resultado');
      killTree();
    });
    await d.getByRole('button', { name: /Confirmar venda/ }).click().catch(() => {});
    await sleep(5000);
    killTree();
    // Queda de energia: o PostgreSQL portátil também morre sem desligar.
    try { execSync('taskkill /F /T /IM postgres.exe', { stdio: 'ignore' }); } catch {}
    await sleep(4000);
    const t0 = Date.now();
    await relaunch(note, 'depois de encerramento forçado');
    note(`Reabriu e entrou em ${Math.round((Date.now() - t0) / 1000)} s (PostgreSQL portátil após kill)`);
    await win.getByRole('button', { name: 'PDV', exact: true }).click();
    await sleep(1500);
    const offer = await win.getByRole('button', { name: 'Recuperar carrinho' }).count();
    note('Oferta "Recuperar carrinho" após reabrir: ' + (offer ? 'sim' : 'não'));
    note('Vendas registradas após reabrir: ' + await salesCount() + ' (antes do kill: ' + salesBefore + ')');
    note('Estoque G (deve ser 0 se a venda gravou): ' + await stockOf(SKU_G));
    await snap('apos-reabrir');
  });

  await scenario('S07', 'Gerente', 'Backup manual, automático e teste de restauração', async note => {
    const dump = path.join(work, 'backup-manual.dump');
    await app.evaluate(({ dialog }, files) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: files.dump });
      dialog.showOpenDialog = async (_w, opts) => (opts?.properties || _w?.properties || []).includes?.('openDirectory')
        ? { canceled: false, filePaths: [files.folder] } : { canceled: false, filePaths: [files.dump] };
    }, { dump, folder: work });
    await win.getByRole('button', { name: 'Configurações' }).click();
    const t0 = Date.now();
    await win.getByRole('button', { name: 'Escolher destino e exportar backup' }).click();
    await win.getByText(/Backup concluído e conferido|Falha|erro/i).first().waitFor({ timeout: 120_000 });
    note(`Exportar backup (${Math.round((Date.now() - t0) / 1000)} s): ` + (await win.getByRole('region', { name: 'Backup local da loja' }).innerText()).split('\n').slice(-1)[0]);
    note('Arquivo: ' + ((await stat(dump).catch(() => null))?.size ?? 'não criado') + ' bytes');
    await win.getByRole('button', { name: 'Verificar arquivo e testar restauração' }).click();
    await win.getByText(/Restauração testada|Falha|erro/i).first().waitFor({ timeout: 180_000 }).catch(() => {});
    note('Verificar restauração: ' + (await win.getByRole('region', { name: 'Backup local da loja' }).innerText()).split('\n').slice(-1)[0]);
    await win.getByRole('button', { name: 'Escolher pasta dos backups' }).click(); await sleep(1500);
    await win.getByRole('button', { name: 'Fazer backup agora' }).click();
    await win.getByText(/Backup feito agora|falhou|erro/i).first().waitFor({ timeout: 120_000 }).catch(() => {});
    note('Backup automático: ' + (await win.getByRole('region', { name: 'Backup local da loja' }).innerText()).split('\n').slice(-1)[0]);
    note('Arquivos na pasta: ' + (await readdir(work)).join(', '));
    await snap('backup');
  });

  await scenario('S08', 'Gerente', 'Atualizador: verificar atualizações', async note => {
    await win.getByRole('button', { name: 'Verificar atualizações agora' }).click();
    await sleep(8000);
    note('Resposta: ' + (await win.getByRole('region', { name: 'Configurações de atualizações' }).innerText()).split('\n').slice(-2).join(' | '));
    await snap('atualizador');
  });

  await scenario('S09', 'Vendedora apressada', 'Impressão do comprovante', async note => {
    const printers = await win.evaluate(() => window.lojaPrinter?.list()).catch(e => 'erro: ' + e.message);
    note('Impressoras vistas pelo app: ' + JSON.stringify(printers));
    const pId = (await variants(SKU_P)).find(v => v.sku === SKU_P)?.id;
    const repo = await api('POST', '/v1/stock/receipts', { variant_id: pId, reference_id: randomUUID(), quantity: 2, note: 'Reposição QA (depois do backup)' });
    note('Reposição de P x2 depois do backup: HTTP ' + repo.status);
    await win.getByRole('button', { name: 'PDV', exact: true }).click();
    await win.getByLabel('Buscar nome, SKU ou código').fill('');
    await addToCart(PRODUCT, 'P');
    const d = await checkoutCash();
    await d.getByRole('button', { name: /Confirmar venda/ }).click();
    await win.getByText(/Venda #\d+ confirmada/).waitFor({ timeout: 15_000 });
    const select = win.getByRole('combobox', { name: 'Impressora do comprovante' });
    const pdf = Array.isArray(printers) ? printers.find(p => /PDF/i.test(p.name)) : null;
    if (await select.count() && pdf) {
      await select.selectOption(pdf.name);
      await win.getByRole('button', { name: 'Imprimir comprovante não fiscal' }).click();
      await sleep(15000);
      note('Depois de imprimir em "' + pdf.name + '": ' + ((await win.getByRole('alert').allInnerTexts()).join(' / ') || 'sem erro na tela'));
    } else note('Seletor de impressora: ' + (await select.count() ? 'presente' : 'ausente'));
    await snap('impressao');
    await win.getByRole('button', { name: 'Nova venda' }).click().catch(() => {});
  });

  await scenario('S10', 'Gerente', 'Restaurar backup (volta ao estado salvo e reinicia)', async note => {
    const dump = path.join(work, 'backup-manual.dump');
    const before = await salesCount();
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, dump);
    await win.getByRole('button', { name: 'Configurações' }).click();
    await win.getByRole('button', { name: 'Escolher backup e restaurar' }).click();
    await sleep(60_000);
    killTree();
    await sleep(4000);
    await relaunch(note, 'depois da restauração');
    note('Vendas antes de restaurar: ' + before);
    const after = await salesCount();
    note('Vendas depois de restaurar (o backup de S07 tinha a contagem anterior à venda de S09): ' + after);
    note('Estoque P depois de restaurar (no backup era 0; a reposição de S09 deve sumir): ' + await stockOf(SKU_P));
    await snap('apos-restaurar');
  });
} finally {
  await writeFile(path.join(out, 'resultados.json'), JSON.stringify(results, null, 1));
  console.info('\n===== RESUMO QA PERSONAS DESKTOP =====');
  for (const r of results) {
    console.info(`${r.id} [${r.status}] ${r.persona} · ${r.title} (${r.seconds}s)`);
    for (const n of r.notes) console.info('   - ' + n);
  }
  await app?.close().catch(() => {});
  killTree();
}
