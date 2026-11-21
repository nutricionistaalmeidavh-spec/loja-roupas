import {test,expect} from '@playwright/test';
test.use({video:'on'});

test('P2: registrar layouts operacionais com vídeo e screenshots reais em todas as larguras',async({page},info)=>{
 test.setTimeout(120000);
 await page.goto('/');
 await page.getByLabel('Usuário').fill('qa-admin');
 await page.getByLabel('Senha',{exact:true}).fill('Senha-QA-Somente-CI-2026');
 await page.getByRole('button',{name:'Entrar na loja'}).click();
 await expect(page.getByRole('heading',{name:'Nova venda'})).toBeVisible();
 const tour=page.getByRole('button',{name:'Pular tour'});
 if(await tour.isVisible())await tour.click();
 for(const [width,height] of [[1440,900],[1366,768],[1280,800],[1024,768],[768,1024],[390,844],[320,568]]){
  await page.setViewportSize({width,height});
  await expect(page.getByRole('heading',{name:'Selecionar produtos'})).toBeVisible();
  const dimensions=await page.evaluate(()=>({viewport:innerWidth,content:document.documentElement.scrollWidth}));
  expect(dimensions.content,'Overflow horizontal: '+width+'px').toBeLessThanOrEqual(dimensions.viewport+1);
  await page.screenshot({path:info.outputPath('pdv-'+width+'x'+height+'.png'),fullPage:width>=768,animations:'disabled'});
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.setViewportSize({width:390,height:844});
 await expect(page.getByRole('navigation',{name:'Navegação da loja'})).toBeVisible();
 await page.screenshot({path:info.outputPath('pdv-mobile-sem-animacao.png'),animations:'disabled'});
});
