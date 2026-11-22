import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from '../src/app.ts';
import {hashPassword,issueSession} from '../src/security.ts';
const connection=process.env.TEST_DATABASE_URL;
test('P1: crediário, clientes, caixa, comissões, fidelidade, estornos Pix e troca em transações canônicas',{
 skip:!connection && 'Requer PostgreSQL QA'},async()=>{
 const db=new Pool({connectionString:connection!}),app=buildApp(db);
 try{
  const store=(await db.query<{id:string}>(`INSERT INTO stores(name) VALUES($1) RETURNING id::text`,['P1 loja QA '+randomUUID()])).rows[0].id;
  const user=(await db.query<{id:string}>(`INSERT INTO users(login,password_hash) VALUES($1,$2) RETURNING id::text`,
   ['p1-'+randomUUID(),await hashPassword('P1-Segura-2026-Obra')])).rows[0].id;
  await db.query("INSERT INTO user_store_roles(user_id,store_id,role_code) VALUES($1,$2,'manager')",[user,store]);
  const token=issueSession();
  await db.query(`INSERT INTO auth_sessions(user_id,token_hash,expires_at)
   VALUES($1,$2,now()+interval '8 hours')`,[user,token.tokenHash]);
  const base={authorization:'Bearer '+token.token,'x-store-id':store};
  const request=(method:'POST'|'GET',url:string,payload?:unknown,k?:string)=>
   app.inject({method,url,headers:{...base,...(method==='POST'?{'idempotency-key':k||randomUUID()}: {})},payload});
  const check=(code:number,res:{statusCode:number;body:string})=>assert.equal(res.statusCode,code,res.body);
  const customer=await request('POST','/v1/management/customers',{name:'Cliente P1',phone:'11999998888',
   loyalty_opt_in:true,marketing_consent:false});
  check(201,customer);const customerId=customer.json().id as string;
  const pin=await request('POST','/v1/auth/operators/pin',{user_id:user,pin:'465732',manager_password:'P1-Segura-2026-Obra'});
  check(200,pin);
  const invalidPin=await request('POST','/v1/auth/operators/switch',{user_id:user,pin:'111111'});
  check(401,invalidPin);
  const pinSwitch=await request('POST','/v1/auth/operators/switch',{user_id:user,pin:'465732'});
  check(200,pinSwitch);
  assert.notEqual(pinSwitch.json().token,token.token);
  const oldSession=await request('GET','/v1/auth/me');
  check(401,oldSession);
  base.authorization='Bearer '+pinSwitch.json().token;

  const products=await request('POST','/v1/catalog/products',{name:'Calças P1',category:'Calças',variants:[
   {sku:'P1-OLD-'+randomUUID().slice(0,8),size:'M',color:'Azul',price_cents:15000},
   {sku:'P1-NEW-'+randomUUID().slice(0,8),size:'G',color:'Azul',price_cents:20000}
  ]});
  check(201,products);const [oldV,newV]=products.json().variants as Array<{id:string}>;
  for(const v of [oldV,newV]){
   const receipt=await request('POST','/v1/stock/receipts',{variant_id:v.id,
    reference_id:randomUUID(),quantity:10,note:'Reposição QA'});
   check(201,receipt);
  }
  const cash=await request('POST','/v1/cash-sessions',{terminal_code:'P1-'+randomUUID().slice(0,6).toUpperCase(),opening_cents:50000});
  check(201,cash);const cashId=cash.json().id as string;
  const rate=await request('POST','/v1/management/commissions/'+user+'/rule',{rate_bps:500});check(200,rate);
  const lim=await request('POST','/v1/management/customers/'+customerId+'/credit-limit',
   {enabled:true,credit_limit_cents:20000});check(200,lim);
  async function sale(variantId:string,payments:unknown[],extras:Record<string,unknown>={}){
   const quote=await request('POST','/v1/sales/quotes',{lines:[{variant_id:variantId,quantity:1}]});check(200,quote);
   const q=quote.json().lines[0];
   const sold=await request('POST','/v1/sales',{cash_session_id:cashId,
    lines:[{variant_id:variantId,quantity:1,expected_price_cents:q.price_cents,expected_price_revision:q.price_revision}],
    payments,customer_id:customerId,seller_id:user,...extras});
   check(201,sold);
   return sold.json() as {id:string;sale_number:number};
  }
  const pix=await sale(oldV.id,[{method:'pix_manual',amount_cents:15000,confirmed:true,external_reference:'pix-p1-'+randomUUID()}]);
  const commission=await request('GET','/v1/management/commissions');check(200,commission);
  assert.ok(Number(commission.json().items[0].accrued_cents)>=750);
  const loyalty=await request('GET','/v1/management/customers/'+customerId+'/loyalty');check(200,loyalty);
  assert.ok(loyalty.json().points>=150);
  const redeem=await request('POST','/v1/management/customers/'+customerId+'/loyalty/redeem',{points:100});check(201,redeem);
  const discounted=await sale(oldV.id,[{method:'customer_credit',amount_cents:100,confirmed:true},
   {method:'cash',amount_cents:14900,confirmed:true}]);
  assert.ok(discounted.id);
  const credit=await sale(oldV.id,[{method:'store_credit',amount_cents:15000,confirmed:true}],
   {credit_installments:[{amount_cents:7500,due_on:'2026-12-01'},{amount_cents:7500,due_on:'2027-01-01'}]});
  assert.ok(credit.id);
  const accounts=await request('GET','/v1/management/accounts?kind=receivable');check(200,accounts);
  const installments=(accounts.json().items as Array<{id:string;amount_cents:string}>)
   .filter(x=>Number(x.amount_cents)===7500);
  assert.equal(installments.length,2);
  const idempotency=randomUUID(),proof='pix-settle-'+randomUUID();
  const settle=()=>request('POST','/v1/management/accounts/'+installments[0].id+'/settlements',{
    amount_cents:2500,method:'pix_manual',external_reference:proof},idempotency);
  const first=await settle();check(201,first);
  const second=await settle();check(200,second);
  assert.equal(first.json().id,second.json().id);
  assert.equal(first.json().remaining_cents,5000);
  const refund=await request('POST','/v1/management/after-sales/external-refund',{
   sale_number:pix.sale_number,sale_line_id:(await request('GET','/v1/management/sales/by-number/'+pix.sale_number)).json().lines[0].id,
   quantity:1,condition:'resellable',reason:'Estorno por insatisfação',method:'pix_manual',
   external_reference:'refund-p1-'+randomUUID(),confirmed:true});
  check(201,refund);
  const refundRepeat=await request('POST','/v1/management/after-sales/external-refund',{
   sale_number:pix.sale_number,sale_line_id:(await request('GET','/v1/management/sales/by-number/'+pix.sale_number)).json().lines[0].id,
   quantity:1,condition:'resellable',reason:'Estorno por insatisfação',method:'pix_manual',
   external_reference:'refund-p1-repeat-'+randomUUID(),confirmed:true});
  check(409,refundRepeat);
  const original=await sale(oldV.id,[{method:'cash',amount_cents:15000,confirmed:true}]);
  const oldLines=await request('GET','/v1/management/sales/by-number/'+original.sale_number);check(200,oldLines);
  const exchange=await request('POST','/v1/management/after-sales/exchange',{
   sale_number:original.sale_number,sale_line_id:oldLines.json().lines[0].id,
   quantity:1,condition:'resellable',replacement_variant_id:newV.id,replacement_quantity:1,
   cash_session_id:cashId,reason:'Troca por numeração G',payment:{method:'cash',confirmed:true}});
  check(201,exchange);
  assert.equal(exchange.json().extra_due_cents,5000);
  const report=await request('GET','/v1/management/dre?month=2026-11');check(200,report);
  assert.equal(report.json().complete,false);
  assert.ok(Number.isInteger(report.json().operating_result_cents));
 }finally{await app.close();await db.end();}
});
