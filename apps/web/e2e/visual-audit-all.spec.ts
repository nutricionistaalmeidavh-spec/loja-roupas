import {test,expect} from '@playwright/test';
test.use({video:'on'});
test('capturas e video da jornada principal desktop', async ({page},info)=>{
  test.setTimeout(90000);
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Bem-vindo à sua loja'})).toBeVisible();
  await page.screenshot({path:info.outputPath('01-login.png'),fullPage:true});
  await page.getByLabel('Usuário').fill('qa-admin');
  await page.getByLabel('Senha').fill('Senha-QA-Somente-CI-2026');
  await page.getByRole('button',{name:'Entrar na loja'}).click();
  await expect(page.getByRole('heading',{name:'Nova venda'})).toBeVisible();
  const tour=page.getByRole('button',{name:'Pular tour'});
  if(await tour.isVisible())await tour.click();
  await page.screenshot({path:info.outputPath('02-pdv.png'),fullPage:true});
  for(const [name,heading,file] of [
    ['Cadastrar produtos','Produtos','03-produtos'],
    ['Entrada de estoque','Estoque','04-estoque'],
    ['Caixa','Caixa','05-caixa'],
    ['Gestão','Gestão','06-gestao']
  ]){
    await page.getByRole('button',{name,exact:true}).click();
    await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible();
    await page.screenshot({path:info.outputPath(file+'.png'),fullPage:true});
  }
  await page.getByRole('button',{name:'Configurações',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Configurações',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('07-configuracoes.png'),fullPage:true});
});