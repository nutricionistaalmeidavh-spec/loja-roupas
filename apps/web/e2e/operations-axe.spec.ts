import {test,expect} from '@playwright/test';
import {existsSync} from 'node:fs';

type A11yViolation={id:string;impact:string|null;nodes:Array<{target:string[];failureSummary?:string}>};
type A11yResults={violations:A11yViolation[]};

test('P2: axe-core WCAG 2.2 AA no painel e diálogo de gestão',async({page})=>{
 const axePath=process.env.LOJA_AXE_CORE_PATH;
 expect(axePath,'Configurar LOJA_AXE_CORE_PATH para executar o gate axe-core OSS').toBeTruthy();
 expect(existsSync(axePath!),'Script axe-core não encontrado; preparar dependência de QA').toBeTruthy();

 await page.goto('/');
 await page.getByLabel('Usuário').fill('qa-admin');
 await page.getByLabel('Senha').fill('Senha-QA-Somente-CI-2026');
 await page.getByRole('button',{name:'Entrar na loja'}).click();
 await page.getByRole('button',{name:'Gestão',exact:true}).click();
 await expect(page.getByRole('region',{name:'Central de ações'})).toBeVisible();
 await page.addScriptTag({path:axePath});
 const audit=async(selector:string)=>{
   const result=await page.evaluate(async css=>{
     const axe=(window as unknown as {axe:{run:(root:Element,options:unknown)=>Promise<A11yResults>}}).axe;
     const el=document.querySelector(css);
     if(!el)throw new Error('Alvo do teste axe indisponível: '+css);
     return axe.run(el,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});
   },selector);
   expect(result.violations.map(v=>({rule:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)})),
    'Violações de acessibilidade em '+selector).toEqual([]);
 };
 await audit('.operations-overview');
 await page.getByRole('link',{name:'Fornecedores'}).click();
 await page.getByRole('button',{name:'Novo fornecedor'}).click();
 await expect(page.getByRole('dialog',{name:'Novo fornecedor'})).toBeVisible();
 await audit('.task-dialog');
});
