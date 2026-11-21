import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from '../src/app.ts';
import {issueSession} from '../src/security.ts';

const connection=process.env.TEST_DATABASE_URL;
test('P2: fila de ações operacionais usa escopo da loja e quantidades canônicas', {
 skip:!connection&&'Exige PostgreSQL de teste'
},async()=>{
 const db=new Pool({connectionString:connection!});
 const app=buildApp(db);
 try {
  const {rows:[store,otherStore]}=await db.query(
   "INSERT INTO stores(name) VALUES('P2 Painel QA'),('P2 Outra Loja') RETURNING id");
  const user=(await db.query('INSERT INTO users(login,password_hash) VALUES($1,$2) RETURNING id',
   ['ops-dashboard-'+randomUUID(),'integration-fixture'])).rows[0];
  await db.query("INSERT INTO user_store_roles VALUES($1,$2,'manager')",[user.id,store.id]);
  const {token,tokenHash}=issueSession();
  await db.query("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[user.id,tokenHash]);
  const headers={authorization:'Bearer '+token,'x-store-id':store.id};
  const write=()=>({...headers,'idempotency-key':randomUUID()});
  const summary=()=>app.inject({url:'/v1/management/operations/summary',headers});
  assert.equal((await app.inject({url:'/v1/management/operations/summary'})).statusCode,401);
  assert.equal((await app.inject({url:'/v1/management/operations/summary',
   headers:{...headers,'x-store-id':otherStore.id}})).statusCode,401);
  const empty=await summary();
  assert.equal(empty.statusCode,200,empty.body);
  for(const value of Object.values(empty.json().counts))assert.equal(value,0);

  const product=await app.inject({method:'POST',url:'/v1/catalog/products',headers:write(),payload:{
   name:'Calça QA P2',category:'Calças',variants:[{sku:'P2-'+randomUUID().slice(0,8),size:'M',color:'Azul',price_cents:1500}]}});
  assert.equal(product.statusCode,201,product.body);
  const variant=product.json().variants[0].id;
  const supplier=await app.inject({method:'POST',url:'/v1/management/suppliers',headers:write(),
   payload:{name:'Fornecedor Operação QA'}});
  assert.equal(supplier.statusCode,201,supplier.body);
  const purchase=await app.inject({method:'POST',url:'/v1/management/purchases',headers:write(),payload:{
   supplier_id:supplier.json().id,variant_id:variant,quantity:5,unit_cost_cents:700}});
  assert.equal(purchase.statusCode,201,purchase.body);
  const pending=await summary();
  assert.equal(pending.json().counts.purchases_to_receive,1);
  const receipt=await app.inject({method:'POST',url:'/v1/management/purchases/'+purchase.json().id+'/receive',
   headers:write(),payload:{received_quantity:4,accepted_quantity:3,reason:'Uma danificada e uma faltante'}});
  assert.equal(receipt.statusCode,200,receipt.body);
  const after=await summary();
  assert.equal(after.statusCode,200,after.body);
  assert.equal(after.json().counts.purchases_to_receive,0);
  assert.equal(after.json().counts.purchase_quarantine_units,1);
  assert.equal(after.json().counts.purchase_missing_units,1);
  assert.equal(after.json().counts.holds_active,0);
  const reserve=await app.inject({method:'POST',url:'/v1/stock/holds',headers:write(),
   payload:{variant_id:variant,quantity:2}});
  assert.equal(reserve.statusCode,201,reserve.body);
  assert.equal((await summary()).json().counts.holds_active,1);
  assert.equal((await summary()).json().counts.pickups_pending,0);
  await db.query("UPDATE stock_holds SET created_at=now()-interval '25 hours' WHERE id=$1",[reserve.json().id]);
  const agedHolds=await app.inject({url:'/v1/stock/holds',headers});
  assert.equal(agedHolds.statusCode,200,agedHolds.body);
  assert.equal(agedHolds.json().holds.find((h:{id:string})=>h.id===reserve.json().id).stale,true);
  assert.equal(agedHolds.json().holds.find((h:{id:string})=>h.id===reserve.json().id).state,'active');
  const release=await app.inject({method:'POST',url:'/v1/stock/holds/'+reserve.json().id+'/release',headers:write()});
  assert.equal(release.statusCode,200,release.body);
  assert.equal((await summary()).json().counts.holds_active,0);

  const published=await app.inject({method:'PUT',
   url:'/v1/management/storefront/variants/'+variant,headers:write(),payload:{published:true}});
  assert.equal(published.statusCode,200,published.body);
  const enabled=await app.inject({method:'PUT',url:'/v1/management/storefront/pickup',
   headers:write(),payload:{enabled:true}});
  assert.equal(enabled.statusCode,200,enabled.body);
  const pickup=await app.inject({method:'POST',url:'/v1/storefront/'+store.id+'/pickup-orders',
   payload:{request_id:randomUUID(),lines:[{variant_id:variant,quantity:1}]}});
  assert.equal(pickup.statusCode,201,pickup.body);
  assert.equal((await summary()).json().counts.pickups_pending,1);
  const cancelled=await app.inject({method:'POST',
   url:'/v1/management/pickup-orders/'+pickup.json().id+'/cancel',headers:write()});
  assert.equal(cancelled.statusCode,200,cancelled.body);
  assert.equal((await summary()).json().counts.pickups_pending,0);

  const open=await app.inject({method:'POST',url:'/v1/cash-sessions',headers:write(),
   payload:{terminal_code:'P2-OPS',opening_cents:0}});
  assert.equal(open.statusCode,201,open.body);
  const sold=await app.inject({method:'POST',url:'/v1/sales',headers:write(),
   payload:{cash_session_id:open.json().id,
    lines:[{variant_id:variant,quantity:2,expected_price_cents:1500,expected_price_revision:1}],
    payments:[{method:'cash',amount_cents:3000,confirmed:true}]}});
  assert.equal(sold.statusCode,201,sold.body);
  const print=await app.inject({method:'POST',url:'/v1/sales/'+sold.json().id+'/print-requests',
   headers:write(),payload:{paper_mm:80}});
  assert.equal(print.statusCode,201,print.body);
  assert.equal((await summary()).json().counts.print_jobs_pending,1);
  const saleDetail=await app.inject({url:'/v1/management/sales/by-number/'+sold.json().sale_number,headers});
  assert.equal(saleDetail.statusCode,200,saleDetail.body);
  const refunded=await app.inject({method:'POST',
   url:'/v1/management/sales/by-number/'+sold.json().sale_number+'/cash-return',headers:write(),
   payload:{cash_session_id:open.json().id,reason:'Peça devolvida com avaria física',
    items:[{sale_line_id:saleDetail.json().lines[0].id,quantity:1,condition:'quarantine'}]}});
  assert.equal(refunded.statusCode,201,refunded.body);
  const summaryWithReturn=await summary();
  assert.equal(summaryWithReturn.json().counts.partially_returned_sales,1);
  assert.equal(summaryWithReturn.json().counts.returned_quarantine_units,1);
  assert.equal(summaryWithReturn.json().counts.print_jobs_pending,1);
 } finally {await app.close();await db.end();}
});
