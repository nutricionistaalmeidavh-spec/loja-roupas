import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from '../src/app.ts';
import {hashPassword,issueSession} from '../src/security.ts';

const connection=process.env.TEST_DATABASE_URL;
type Res={statusCode:number;body:string;json:()=>any};

test('condicional, promoções, relatórios de moda, aniversariantes, vale-troca e chave Pix',{
 skip:!connection&&'Requer PostgreSQL QA'},async()=>{
 const db=new Pool({connectionString:connection!}),app=buildApp(db);
 try{
  const store=(await db.query<{id:string}>(`INSERT INTO stores(name) VALUES($1) RETURNING id::text`,['Loja Extras '+randomUUID().slice(0,6)])).rows[0].id;
  const manager=(await db.query<{id:string}>(`INSERT INTO users(login,password_hash) VALUES($1,$2) RETURNING id::text`,
   ['gestor-'+randomUUID().slice(0,8),await hashPassword('Senha-Gestor-QA-2026')])).rows[0].id;
  await db.query("INSERT INTO user_store_roles(user_id,store_id,role_code) VALUES($1,$2,'manager')",[manager,store]);
  const session=issueSession();
  await db.query(`INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')`,[manager,session.tokenHash]);
  const req=async(method:'GET'|'POST'|'PUT',url:string,payload?:unknown):Promise<Res>=>
   await app.inject({method,url,headers:{authorization:'Bearer '+session.token,'x-store-id':store,
    ...(method==='GET'?{}:{'idempotency-key':randomUUID()})},...(payload===undefined?{}:{payload:payload as object})});
  const ok=(code:number,res:Res)=>{assert.equal(res.statusCode,code,res.body);return res.json();};
  const tag=randomUUID().slice(0,6).toUpperCase();
  const product=ok(201,await req('POST','/v1/catalog/products',{name:'Calça Extras',category:'Jeans',
   variants:[{sku:'EX-P-'+tag,color:'Azul',size:'P',price_cents:10000},{sku:'EX-M-'+tag,color:'Azul',size:'M',price_cents:8000}]}));
  const [p,m]=product.variants.map((v:{id:string})=>v.id);
  for(const id of [p,m])ok(201,await req('POST','/v1/stock/receipts',{variant_id:id,reference_id:randomUUID(),quantity:5,note:'Estoque do teste extras'}));
  const available=async(id:string)=>Number((await db.query<{a:string}>('SELECT (on_hand-reserved)::text AS a FROM stock_balances WHERE store_id=$1 AND variant_id=$2',[store,id])).rows[0].a);

  // Aniversário e lista do mês.
  const month=new Date().getMonth()+1;
  const birth='1990-'+String(month).padStart(2,'0')+'-01';
  const customer=ok(201,await req('POST','/v1/management/customers',{name:'Ana Condicional',phone:'11955554444',birth_date:birth}));
  assert.equal((await req('POST','/v1/management/customers',{name:'Data Ruim',birth_date:'2990-01-01'})).statusCode,422);
  const birthdays=ok(200,await req('GET','/v1/customers/birthdays?month='+month));
  assert.deepEqual(birthdays.items.map((c:{name:string})=>c.name),['Ana Condicional']);

  // Condicional reserva o estoque e, ao fechar, devolve as peças e manda o que ficou para o carrinho.
  const due=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
  const bag=ok(201,await req('POST','/v1/consignments',{customer_id:customer.id,due_on:due,lines:[{variant_id:p,quantity:2},{variant_id:m,quantity:1}]}));
  assert.equal(bag.number,1);assert.equal(bag.lines.length,2);
  assert.equal(await available(p),3);assert.equal(await available(m),4);
  assert.equal((await req('POST','/v1/consignments',{customer_id:customer.id,due_on:due,lines:[{variant_id:p,quantity:9}]})).statusCode,409);
  assert.equal(ok(200,await req('GET','/v1/consignments')).items.length,1);
  assert.equal((await req('POST','/v1/consignments/'+bag.id+'/close',{lines:[{variant_id:p,kept_quantity:3}]})).statusCode,422);
  const closed=ok(200,await req('POST','/v1/consignments/'+bag.id+'/close',{lines:[{variant_id:p,kept_quantity:1}]}));
  assert.deepEqual(closed.kept,[{variant_id:p,quantity:1}]);
  assert.equal(await available(p),5);assert.equal(await available(m),5);
  assert.equal(ok(200,await req('GET','/v1/consignments')).items.length,0);

  // Promoção "leve 2 pague 1" em Jeans: a peça mais barata sai de graça, sem precisar de motivo de desconto.
  const today=new Date().toISOString().slice(0,10);
  assert.equal((await req('POST','/v1/promotions',{name:'Errada',kind:'buy_x_pay_y',buy_quantity:2,pay_quantity:2,starts_on:today,ends_on:today})).statusCode,422);
  const promo=ok(201,await req('POST','/v1/promotions',{name:'Jeans leve 2 pague 1',kind:'buy_x_pay_y',category:'Jeans',buy_quantity:2,pay_quantity:1,
   starts_on:new Date(Date.now()-86400000).toISOString().slice(0,10),ends_on:new Date(Date.now()+86400000).toISOString().slice(0,10)}));
  const lines=[{variant_id:p,quantity:1},{variant_id:m,quantity:1}];
  const quote=ok(200,await req('POST','/v1/sales/quotes',{lines}));
  assert.equal(quote.subtotal_cents,18000);assert.equal(quote.promotion_cents,8000);assert.equal(quote.total_cents,10000);
  assert.equal(quote.lines.find((l:{variant_id:string})=>l.variant_id===m).promotion_name,'Jeans leve 2 pague 1');
  const cash=ok(201,await req('POST','/v1/cash-sessions',{terminal_code:'EXT-01',opening_cents:5000}));
  const sale=ok(201,await req('POST','/v1/sales',{cash_session_id:cash.id,
   lines:quote.lines.map((l:{variant_id:string;quantity:number;price_cents:number;price_revision:number})=>({variant_id:l.variant_id,quantity:l.quantity,expected_price_cents:l.price_cents,expected_price_revision:l.price_revision})),
   payments:[{method:'cash',amount_cents:10000,confirmed:true}]}));
  assert.equal(sale.total_cents,10000);
  const receipt=(await req('GET','/v1/sales/'+sale.id+'/receipt?cols=42')).body;
  assert.match(receipt,/DESCONTO \(Promoção: Jeans leve 2 pague 1\)/);
  const gift=await req('GET','/v1/sales/'+sale.id+'/receipt?gift=true&cols=32');
  assert.equal(gift.statusCode,200);
  assert.match(gift.body,/VALE-TROCA/);assert.doesNotMatch(gift.body,/R\$/);
  ok(200,await req('POST','/v1/promotions/'+promo.id+'/end'));
  assert.equal(ok(200,await req('POST','/v1/sales/quotes',{lines})).total_cents,18000);

  // Relatórios de moda: curva ABC e giro por tamanho.
  const report=ok(200,await req('GET','/v1/reports/fashion?days=30'));
  assert.equal(report.abc[0].name,'Calça Extras');assert.equal(report.abc[0].class,'A');
  const sizeP=report.by_size.find((s:{value:string})=>s.value==='P');
  assert.equal(sizeP.sold,1);assert.equal(sizeP.on_hand,4);assert.equal(sizeP.sell_through_bps,2000);

  // Chave Pix fica nos dados da loja.
  ok(200,await req('PUT','/v1/management/store-profile',{name:'Loja Extras',max_cashier_discount_bps:1000,pix_key:'loja@exemplo.com',pix_city:'São Paulo'}));
  const profile=ok(200,await req('GET','/v1/management/store-profile'));
  assert.equal(profile.pix_key,'loja@exemplo.com');assert.equal(profile.pix_city,'São Paulo');
 }finally{await app.close();await db.end();}
});
