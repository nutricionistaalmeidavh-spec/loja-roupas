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
  const release=await app.inject({method:'POST',url:'/v1/stock/holds/'+reserve.json().id+'/release',headers:write()});
  assert.equal(release.statusCode,200,release.body);
  assert.equal((await summary()).json().counts.holds_active,0);
 } finally {await app.close();await db.end();}
});
