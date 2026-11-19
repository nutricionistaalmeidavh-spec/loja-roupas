import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { buildApp } from '../src/app.ts';
import { hashPassword, issueSession } from '../src/security.ts';

const connection = process.env.TEST_DATABASE_URL;
test('M3: caixa, cotação, venda ACID, split, troco, recibo e fechamento idempotentes',{
 skip:!connection && 'Exige PostgreSQL de teste'
},async()=>{
 const db=new Pool({connectionString:connection!}); const app=buildApp(db);
 try{
  const st=await db.query<{id:string}>("INSERT INTO stores(name) VALUES('QA M3') RETURNING id::text");
  const storeId=st.rows[0].id;
  const us=await db.query<{id:string}>("INSERT INTO users(login,password_hash) VALUES($1,$2) RETURNING id::text",
    ['m3-'+randomUUID(),await hashPassword('Senha-Pos-QA-2026!')]);
  await db.query("INSERT INTO user_store_roles(user_id,store_id,role_code) VALUES($1,$2,'manager')",[us.rows[0].id,storeId]);
  const {token,tokenHash}=issueSession();
  await db.query("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')",[us.rows[0].id,tokenHash]);
  const headers={authorization:'Bearer '+token,'x-store-id':storeId};
  const write=(key=randomUUID())=>({...headers,'idempotency-key':key});
  const unauthorized=await app.inject({method:'POST',url:'/v1/cash-sessions',payload:{terminal_code:'CAIXA-01',opening_cents:10000}});
  assert.equal(unauthorized.statusCode,401);
  const opened=await app.inject({method:'POST',url:'/v1/cash-sessions',headers:write(),
    payload:{terminal_code:'CAIXA-01',opening_cents:10000}});
  assert.equal(opened.statusCode,201,opened.body);
  const cashId=opened.json().id;
  const current=await app.inject({url:'/v1/cash-sessions/current?terminal=CAIXA-01',headers});
  assert.equal(current.statusCode,200,current.body);
  assert.equal(current.json().id,cashId);
  const duplicate=await app.inject({method:'POST',url:'/v1/cash-sessions',headers:write(),
    payload:{terminal_code:'CAIXA-01',opening_cents:10000}});
  assert.equal(duplicate.statusCode,409,duplicate.body);
  const product=await app.inject({method:'POST',url:'/v1/catalog/products',headers:write(),
    payload:{name:'Camisa QA M3',category:'Feminino',variants:[{
      sku:'M3-'+randomUUID().slice(0,12),color:'Preto',size:'M',price_cents:14990
    }]}});
  assert.equal(product.statusCode,201,product.body);
  const variantId=product.json().variants[0].id;
  const receipt=await app.inject({method:'POST',url:'/v1/stock/receipts',headers:write(),
    payload:{variant_id:variantId,reference_id:randomUUID(),quantity:3}});
  assert.equal(receipt.statusCode,201,receipt.body);
  const quote=await app.inject({method:'POST',url:'/v1/sales/quotes',headers,
    payload:{lines:[{variant_id:variantId,quantity:2}]}});
  assert.equal(quote.statusCode,200,quote.body);
  assert.equal(quote.json().total_cents,29980);
  assert.equal(quote.json().lines[0].price_cents,14990);
  const payload={
    cash_session_id:cashId,
    lines:[{variant_id:variantId,quantity:2,expected_price_cents:14990,expected_price_revision:1}],
    payments:[
      {method:'pix_manual',amount_cents:9990,confirmed:true,external_reference:'PIX-QA-'+randomUUID()},
      {method:'cash',amount_cents:20000,confirmed:true}
    ]
  };
  const saleKey=randomUUID();
  const sold=await app.inject({method:'POST',url:'/v1/sales',headers:write(saleKey),payload});
  assert.equal(sold.statusCode,201,sold.body);
  assert.equal(sold.json().total_cents,29980);
  assert.equal(sold.json().change_cents,10);
  assert.equal(sold.json().status,'confirmed');
  const replay=await app.inject({method:'POST',url:'/v1/sales',headers:write(saleKey),payload});
  assert.equal(replay.statusCode,201,replay.body);
  assert.equal(replay.json().id,sold.json().id);
  const reused=await app.inject({method:'POST',url:'/v1/sales',headers:write(saleKey),
    payload:{...payload,payments:[{method:'cash',amount_cents:29980,confirmed:true}]}});
  assert.equal(reused.statusCode,409);
  const stock=await db.query<{on_hand:string}>(
    'SELECT on_hand::text FROM stock_balances WHERE store_id=$1 AND variant_id=$2',[storeId,variantId]);
  assert.equal(stock.rows[0].on_hand,'1');
  const saleRows=await db.query<{count:string}>('SELECT count(*)::text AS count FROM sales WHERE store_id=$1',[storeId]);
  assert.equal(saleRows.rows[0].count,'1');
  const over=await app.inject({method:'POST',url:'/v1/sales',headers:write(),
    payload:{...payload,lines:[{...payload.lines[0],quantity:2}],payments:[{method:'cash',amount_cents:29980,confirmed:true}]}});
  assert.equal(over.statusCode,409,over.body);
  const withoutConfirm=await app.inject({method:'POST',url:'/v1/sales',headers:write(),
    payload:{...payload,lines:[{...payload.lines[0],quantity:1}],payments:[
      {method:'pix_manual',amount_cents:14990,confirmed:false,external_reference:'PIX-TEMP'}]}});
  assert.equal(withoutConfirm.statusCode,422,withoutConfirm.body);
  const read=await app.inject({url:'/v1/sales/'+sold.json().id,headers});
  assert.equal(read.statusCode,200,read.body);
  assert.equal(read.json().lines.length,1);
  assert.equal(read.json().payments.length,2);
  const nonFiscal=await app.inject({url:'/v1/sales/'+sold.json().id+'/receipt',headers});
  assert.equal(nonFiscal.statusCode,200,nonFiscal.body);
  assert.match(nonFiscal.body,/COMPROVANTE NÃO FISCAL/);
  assert.match(nonFiscal.body,/Camisa QA M3/);
  const printKey=randomUUID();
  const print=()=>app.inject({method:'POST',url:'/v1/sales/'+sold.json().id+'/print-requests',
    headers:write(printKey),payload:{paper_mm:58}});
  const printed=await print();
  assert.equal(printed.statusCode,201,printed.body);
  assert.equal((await print()).json().id,printed.json().id);
  const audit=await db.query("SELECT count(*)::text AS count FROM audit_logs WHERE store_id=$1 AND action='receipt.print.request'",[storeId]);
  assert.equal(audit.rows[0].count,'1');
  const summary=await app.inject({url:'/v1/management/sales-summary',headers});
  assert.equal(summary.statusCode,200,summary.body);
  assert.equal(summary.json().days[0].gross_cents,'29980');
  const closing=await app.inject({method:'POST',url:'/v1/cash-sessions/'+cashId+'/close',headers:write(),
    payload:{counted_cash_cents:29990}});
  assert.equal(closing.statusCode,200,closing.body);
  assert.equal(closing.json().expected_cash_cents,29990);
  assert.equal(closing.json().difference_cents,0);
  const afterClose=await app.inject({method:'POST',url:'/v1/sales',headers:write(),payload:{
    ...payload,lines:[{...payload.lines[0],quantity:1}],payments:[{method:'cash',amount_cents:14990,confirmed:true}]
  }});
  assert.equal(afterClose.statusCode,409,afterClose.body);
 }finally{await app.close();await db.end();}
});
