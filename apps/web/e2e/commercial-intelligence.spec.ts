import {test,expect} from '@playwright/test';

test('configura a meta e navega pelo painel em sete larguras',async({page},testInfo)=>{
  await page.goto('/');
  await page.getByLabel('Usuário').fill('qa-admin');
  await page.getByLabel('Senha').fill('Senha-QA-Somente-CI-2026');
  await page.getByRole('button',{name:'Entrar na loja'}).click();
  await page.getByRole('button',{name:'Gestão',exact:true}).click();
  await page.getByRole('link',{name:'Inteligência'}).click();
  const heading=page.getByRole('heading',{name:'Inteligência comercial'});
  await expect(heading).toBeVisible();
  await page.getByText('Personalizar painel',{exact:true}).focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Meta mensal (R$)',{exact:true}).fill('15000,00');
  await page.getByLabel('Limite de estoque baixo',{exact:true}).fill('10');
  await page.getByRole('button',{name:'Salvar preferências'}).click();
  await expect(page.getByText('Preferências salvas.')).toBeVisible();
  await expect(page.getByRole('definition').filter({hasText:/15\.000,00/}).first()).toBeVisible();
  for(const width of [320,390,600,768,1024,1280,1440]){
    await page.setViewportSize({width,height:900});
    if(width<=600){
      await page.getByLabel('Página',{exact:true}).selectOption('pdv');
      await page.getByLabel('Página',{exact:true}).selectOption('gestao');
    }else{
      await page.getByRole('button',{name:'PDV',exact:true}).click();
      await page.getByRole('button',{name:'Gestão',exact:true}).click();
    }
    await page.getByRole('link',{name:'Inteligência'}).click();
    await expect(heading).toBeVisible();
    await expect(page.getByRole('definition').filter({hasText:/15\.000,00/}).first()).toBeVisible();
    await heading.scrollIntoViewIfNeeded();
    await page.screenshot({path:testInfo.outputPath('gestao-'+width+'.png')});
  }
});
