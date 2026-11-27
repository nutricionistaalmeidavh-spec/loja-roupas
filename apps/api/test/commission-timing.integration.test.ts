import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from '../src/app.ts';
import {hashPassword,issueSession} from '../src/security.ts';

const connection=process.env.TEST_DATABASE_URL;
type Res={statusCode:number;body:string;json:()=>any};

test('comissão do crediário: o gestor escolhe pagar na venda ou só depois que a cliente paga',{
 skip:!connection&&'Requer PostgreSQL QA'},async()=>{
 const db=new Pool({connectionString:connection!}),app=buildApp(db);
 try{
  const store=(await db.query<{id:string}>(`INSERT INTO stores(name) VALUES($1) RETURNING id::text`,['Loja Comissão '+randomUUID().slice(0,6)])).rows[0].id;
  const manager=(await db.query<{id:string}>(`INSERT INTO users(login,password_hash) VALUES($1,$2) RETURNING id::text`,
   ['gestor-'+randomUUID().slice(0,8),await hashPassword('Senha-Gestor-QA-2026')])).rows[0].id;
  await db.query("INSERT INTO user_store_roles(user_id,store_id,role_code) VALUES($1,$2,'manager')",[manager,store]);
  const session=issueSession();
  await db.query(`INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')`,[manager,session.tokenHash]);
  const req=async(method:'GET'|'POST'|'PUT',url:string,payload?:unknown):Promise<Res>=>
   await app.inject({method,url,headers:{authorization:'Bearer '+session.token,'x-store-id':store,
    ...(method==='GET'?{}:{'idempotency-key':randomUUID()})},...(payload===undefined?{}:{payload:payload as object})});
  const ok=(code:number,res:Res)=>{assert.equal(res.statusCode,code,res.body);return res.json();};

  // Padrão: só depois do pagamento.
  assert.equal(ok(200,await req('GET','/v1/management/store-profile')).commission_timing,'on_payment');
  ok(200,await req('POST','/v1/management/commissions/'+manager+'/rule',{rate_bps:1000}));
  const product=ok(201,await req('POST','/v1/catalog/products',{name:'Saia Comissão',category:'Feminino',
   variants:[{sku:'CM-'+randomUUID().slice(0,8),color:'Preta',size:'M',price_cents:10000}]}));
  const variant=product.variants[0].id;
  ok(201,await req('POST','/v1/stock/receipts',{variant_id:variant,reference_id:randomUUID(),quantity:5,note:'Estoque do teste de comissão'}));
  const cash=ok(201,await req('POST','/v1/cash-sessions',{terminal_code:'COM-01',opening_cents:10000}));
  const customer=ok(201,await req('POST','/v1/management/customers',{name:'Cliente Comissão',phone:'11977776666',loyalty_opt_in:false}));
  ok(200,await req('POST','/v1/management/customers/'+customer.id+'/credit-limit',{enabled:true,credit_limit_cents:100000}));
  const sale=ok(201,await req('POST','/v1/sales',{cash_session_id:cash.id,customer_id:customer.id,
   lines:[{variant_id:variant,quantity:2,expected_price_cents:10000,expected_price_revision:1}],
   payments:[{method:'store_credit',amount_cents:20000,confirmed:true}],
   credit_installments:[{amount_cents:10000,due_on:'2027-01-10'},{amount_cents:10000,due_on:'2027-02-10'}]}));
  const mine=async()=>ok(200,await req('GET','/v1/management/commissions')).items.find((s:{seller_id:string})=>s.seller_id===manager);
  const pay=(amount_cents:number)=>req('POST','/v1/management/commissions/'+manager+'/payout',
   {amount_cents,method:'bank_transfer',external_reference:'TED-'+randomUUID().slice(0,8)});

  let row=await mine();
  assert.equal(row.accrued_cents,'2000');assert.equal(row.held_cents,'2000');
  const early=await pay(1);
  assert.equal(early.statusCode,409,early.body);assert.equal(early.json().code,'COMMISSION_DUE');

  // A cliente paga a primeira parcela: metade da comissão é liberada.
  const first=(await db.query<{id:string}>(`SELECT id::text FROM retail_accounts WHERE source_id=$1 ORDER BY due_on LIMIT 1`,[sale.id])).rows[0].id;
  ok(201,await req('POST','/v1/management/accounts/'+first+'/settlements',{amount_cents:10000,method:'pix_manual',external_reference:'PIX-PARCELA-1'}));
  row=await mine();
  assert.equal(row.held_cents,'1000');
  assert.equal((await pay(1001)).statusCode,409);
  ok(201,await pay(1000));

  // O gestor muda para pagar na venda: o restante fica liberado na hora.
  ok(200,await req('PUT','/v1/management/store-profile',{name:'Loja Comissão',max_cashier_discount_bps:1000,commission_timing:'on_sale'}));
  row=await mine();
  assert.equal(row.held_cents,'0');
  ok(201,await pay(1000));
 }finally{await app.close();await db.end();}
});
