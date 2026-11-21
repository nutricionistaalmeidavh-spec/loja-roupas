import {test,expect} from '@playwright/test';
test.use({video:'on'});
test('capturas e video mobile, tablet e carrinho',async({page},info)=>{
  test.setTimeout(90000);
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Bem-vindo à sua loja'})).toBeVisible();
  await page.screenshot({path:info.outputPath('01-login-mobile-390.png'),fullPage:true});
  await page.getByLabel('Usuário').fill('qa-admin');
  await page.getByLabel('Senha').fill('Senha-QA-Somente-CI-2026');
  await page.getByRole('button',{name:'Entrar na loja'}).click();
  await expect(page.getByRole('heading',{name:'Nova venda'})).toBeVisible();
  const tour=page.getByRole('button',{name:'Pular tour'});
  if(await tour.isVisible())await tour.click();
  await page.screenshot({path:info.outputPath('02-pdv-mobile-390.png'),fullPage:true});
  for(const [value,title] of [['produtos','Produtos'],['estoque','Estoque'],['caixa','Caixa'],['gestao','Gestão']]){
    await page.getByLabel('Página',{exact:true}).selectOption(value);
    await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
    await page.screenshot({path:info.outputPath('mobile-'+value+'-390.png'),fullPage:true});
  }
  await page.getByLabel('Página',{exact:true}).selectOption('configuracoes');
  await expect(page.getByRole('heading',{name:'Configurações',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('mobile-configuracoes-390.png'),fullPage:true});
  await page.getByLabel('Página',{exact:true}).selectOption('pdv');
  await page.getByRole('button',{name:/Ver carrinho/}).click();
  await expect(page.getByRole('dialog',{name:'Carrinho'})).toBeVisible();
  await page.screenshot({path:info.outputPath('07-carrinho-mobile-390.png')});
  await page.getByRole('dialog',{name:'Carrinho'}).getByRole('button',{name:/Fechar/}).click();
  await page.setViewportSize({width:320,height:568});
  await page.screenshot({path:info.outputPath('08-pdv-mobile-320.png')});
  await page.setViewportSize({width:768,height:1024});
  await page.screenshot({path:info.outputPath('09-pdv-tablet-768.png'),fullPage:true});
});