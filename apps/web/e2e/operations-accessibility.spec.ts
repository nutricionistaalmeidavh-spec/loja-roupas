import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

test('P1/P2: central de ações, conferência em diálogo acessível e saldos segregados', async ({page,request})=>{
 const login={login:'qa-admin',password:'Senha-QA-Somente-CI-2026'};
 const session=await request.post('/v1/auth/sessions',{data:login});
 expect(session.ok()).toBeTruthy();
 const {token,stores}=await session.json();
 const store=stores[0].store_id as string;
 const headers=()=>({authorization:'Bearer '+token,'x-store-id':store,'idempotency-key':randomUUID()});
 const tag=randomUUID().slice(0,8);
 const product=await request.post('/v1/catalog/products',{headers:headers(),
  data:{name:'Vestido P1 QA '+tag,category:'Vestidos',
   variants:[{sku:'P1-'+tag,price_cents:1990,color:'Azul',size:'M'}]}});
 expect(product.status()).toBe(201);
 const variant=(await product.json()).variants[0].id;
 const supplier=await request.post('/v1/management/suppliers',{headers:headers(),data:{name:'Fornecedor P1 QA '+tag}});
 expect(supplier.status()).toBe(201);
 const purchase=await request.post('/v1/management/purchases',{headers:headers(),data:{
   supplier_id:(await supplier.json()).id,variant_id:variant,quantity:4,unit_cost_cents:1100
 }});
 expect(purchase.status()).toBe(201);

 await page.goto('/');
 await page.getByLabel('Usuário').fill(login.login);
 await page.getByLabel('Senha').fill(login.password);
 await page.getByRole('button',{name:'Entrar na loja'}).click();
 await page.getByRole('button',{name:'Gestão',exact:true}).click();
 const actions=page.getByRole('region',{name:'Central de ações'});
 await expect(actions).toBeVisible();
 await expect(actions.getByText('Compras por conferir')).toBeVisible();

 await page.setViewportSize({width:390,height:844});
 const rect=await actions.boundingBox();
 expect(rect).not.toBeNull();
 expect(rect!.x).toBeGreaterThanOrEqual(-2);
 expect(rect!.x+rect!.width).toBeLessThanOrEqual(392);

 await actions.getByRole('button',{name:'Conferir compras'}).click();
 const row=page.getByRole('listitem').filter({hasText:'P1-'+tag});
 await expect(row.getByRole('button',{name:'Conferir recebimento'})).toBeVisible();
 await row.getByRole('button',{name:'Conferir recebimento'}).click();
 const dialog=page.getByRole('dialog',{name:/Conferir recebimento/});
 await expect(dialog).toBeVisible();
 await expect(dialog).toHaveAttribute('aria-modal','true');
 await page.keyboard.press('Escape');
 await expect(dialog).toBeHidden();
 await expect(row.getByRole('button',{name:'Conferir recebimento'})).toBeFocused();
 await row.getByRole('button',{name:'Conferir recebimento'}).click();
 const inspector=page.getByRole('dialog',{name:/Conferir recebimento/});
 await inspector.getByLabel('Quantidade entregue').fill('3');
 await inspector.getByLabel('Quantidade aprovada para venda').fill('2');
 await expect(inspector.getByText(/2 liberadas · 1 em quarentena · 1 faltantes/)).toBeVisible();
 await inspector.getByLabel('Justificativa (obrigatória se houver divergência)').fill('Uma peça avariada; uma peça não entregue');
 await inspector.getByRole('button',{name:'Confirmar conferência e liberar aprovadas'}).click();
 await expect(inspector).toBeHidden();
 await expect(row.getByText(/Conferido: 2 aprovadas/)).toBeVisible();
 const result=await request.get('/v1/management/operations/summary',{headers:headers()});
 expect(result.ok()).toBeTruthy();
 expect((await result.json()).counts.purchase_quarantine_units).toBeGreaterThanOrEqual(1);
});
