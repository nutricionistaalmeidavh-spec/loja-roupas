import {test,expect} from '@playwright/test';

async function openStore(page:import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Usuário').fill('qa-admin');
  await page.getByLabel('Senha', {exact:true}).fill('Senha-QA-Somente-CI-2026');
  await page.getByRole('button',{name:'Entrar na loja'}).click();
  await expect(page.getByRole('heading',{name:'Nova venda'})).toBeVisible();
}

test('login separa ajuda técnica e permite conferir a senha',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Mostrar senha'})).toBeVisible();
  await page.getByLabel('Senha',{exact:true}).fill('teste');
  await page.getByRole('button',{name:'Mostrar senha'}).click();
  await expect(page.getByLabel('Senha',{exact:true})).toHaveAttribute('type','text');
  await expect(page.getByText('Primeiro acesso ou instalação')).toBeVisible();
});

test('operador identifica sua loja pelo nome e navega por ícones',async({page})=>{
  await openStore(page);
  await expect(page.getByText('Loja QA',{exact:false})).toBeVisible();
  await expect(page.locator('.icon-rail svg')).toHaveCount(7);
  await expect(page.getByRole('button',{name:'PDV',exact:true})).toHaveAttribute('aria-current','page');
  await expect(page.locator('.topbar')).not.toContainText(/manager|[a-f0-9]{8}-/i);
});

test('carrinho modal não disputa foco nem tela com o guia inicial',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await openStore(page);
  await page.getByRole('button',{name:/Ver carrinho/}).click();
  await expect(page.getByRole('dialog',{name:'Carrinho'})).toBeVisible();
  await expect(page.getByRole('dialog',{name:'Guia inicial da loja'})).toHaveCount(0);
});

test('gestão apresenta indicadores reais e não exibe área vazia sem contexto',async({page})=>{
  await openStore(page);
  await page.getByRole('button',{name:'Gestão',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Vendas e devoluções nos últimos 30 dias'})).toBeVisible();
  await expect(page.getByRole('region',{name:'Resumo da gestão'})).toBeVisible();
});

test('layout operacional não cria scroll horizontal em larguras essenciais',async({page})=>{
  await openStore(page);
  const tour=page.getByRole('button',{name:'Pular tour'});
  if(await tour.isVisible())await tour.click();
  for(const width of [320,390,768,1024,1280,1440]){
    await page.setViewportSize({width,height:900});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    expect(overflow, 'overflow na largura '+width).toBeLessThanOrEqual(1);
  }
});
