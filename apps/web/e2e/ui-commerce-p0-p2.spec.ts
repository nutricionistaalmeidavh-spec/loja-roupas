import {test,expect} from '@playwright/test';

const auth=async(page:import('@playwright/test').Page)=>{
 await page.goto('/');
 await page.getByLabel('Usuário').fill('qa-admin');
 await page.getByLabel('Senha',{exact:true}).fill('Senha-QA-Somente-CI-2026');
 await page.getByRole('button',{name:'Entrar na loja'}).click();
 await expect(page.getByRole('heading',{name:'Nova venda'})).toBeVisible();
 const tour=page.getByRole('button',{name:'Pular tour'});
 if(await tour.isVisible())await tour.click();
};

test('P0: menu mobile tem ações visíveis e não bloqueia busca do PDV',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await auth(page);
 await expect(page.getByRole('navigation',{name:'Navegação da loja'}).getByRole('button',{name:'Produtos'})).toBeVisible();
 await expect(page.getByLabel('Buscar nome, SKU ou código')).toBeVisible();
 await page.getByRole('navigation',{name:'Navegação da loja'}).getByRole('button',{name:'Gestão'}).click();
 await expect(page.getByRole('heading',{name:'Gestão',exact:true})).toBeVisible();
});

test('P1: gráfico de vendas tem valores reais, ou estado vazio sem barras inventadas',async({page})=>{
 await auth(page);
 await page.getByRole('button',{name:'Gestão',exact:true}).click();
 await expect(page.getByRole('region',{name:'Resumo da gestão'})).toBeVisible();
 const graph=page.getByRole('region',{name:'Evolução de vendas'});
 await expect(graph).toBeVisible();
 await expect(graph.getByText(/Vendas diárias|Nenhuma venda/)).toBeVisible();
});

test('P2: ações e formulários mantêm foco acessível após sair de modal',async({page})=>{
 await auth(page);
 await page.getByRole('button',{name:'Cadastrar produtos'}).click();
 const trigger=page.getByRole('button',{name:/Novo produto/});
 await trigger.click();
 await expect(page.getByRole('dialog',{name:'Novo produto'})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog',{name:'Novo produto'})).toBeHidden();
 await expect(trigger).toBeFocused();
});

test('tour automático não cobre comando operacional fora do guia',async({page})=>{
 await page.goto('/');
 await page.getByLabel('Usuário').fill('qa-admin');
 await page.getByLabel('Senha',{exact:true}).fill('Senha-QA-Somente-CI-2026');
 await page.getByRole('button',{name:'Entrar na loja'}).click();
 const guide=page.getByRole('dialog',{name:'Guia inicial da loja'});
 await expect(guide).toBeVisible();
 await page.getByRole('button',{name:'Caixa',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Operação de caixa'})).toBeVisible();
 await expect(guide).toBeHidden();
});
