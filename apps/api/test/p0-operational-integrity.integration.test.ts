import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from '../src/app.ts';
import {issueSession} from '../src/security.ts';

const database=process.env.TEST_DATABASE_URL;

test('P0: entrada por conferência, devolução parcial e quarentena sem duplicidade', {
  skip:!database && 'Exige PostgreSQL de teste'
},async()=>{
 const db=new Pool({connectionString:database!});
 const app=buildApp(db);
 try {
  const store=(await db.query("INSERT INTO stores(name) VALUES('Loja P0 QA') RETURNING id")).rows[0];
  const user=(await db.query('INSERT INTO users(login,password_hash) VALUES($1,$2) RETURNING id',
   ['p0-'+randomUUID(),'integration-fixture'])).rows[0];
  await db.query("INSERT INTO user_store_roles VALUES($1,$2,'manager')",[user.id,store.id]);
  const {token,tokenHash}=issueSession();
  await db.query("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[user.id,tokenHash]);
  const headers={authorization:'Bearer '+token,'x-store-id':store.id};
  const write=(id=randomUUID())=>({...headers,'idempotency-key':id});
  const product=await app.inject({method:'POST',url:'/v1/catalog/products',headers:write(),
   payload:{name:'Blusa P0',category:'Blusas',variants:[{sku:'P0-'+randomUUID().slice(0,8),size:'M',color:'Preta',price_cents:1000}]}});
  assert.equal(product.statusCode,201,product.body);
  const variant=product.json().variants[0].id;
  const supplier=await app.inject({method:'POST',url:'/v1/management/suppliers',headers:write(),payload:{name:'Fornecedor P0'}});
  assert.equal(supplier.statusCode,201,supplier.body);
  const purchase=await app.inject({method:'POST',url:'/v1/management/purchases',headers:write(),
   payload:{supplier_id:supplier.json().id,variant_id:variant,quantity:4,unit_cost_cents:400}});
  assert.equal(purchase.statusCode,201,purchase.body);
  const receivePath='/v1/management/purchases/'+purchase.json().id+'/receive';
  const missingCheck=await app.inject({method:'POST',url:receivePath,headers:write()});
  assert.equal(missingCheck.statusCode,400,'A conferência não pode ser ignorada');
  const invalid=await app.inject({method:'POST',url:receivePath,headers:write(),
   payload:{received_quantity:2,accepted_quantity:3,reason:'Diferença informada'}});
  assert.equal(invalid.statusCode,422,invalid.body);
  const checked={received_quantity:3,accepted_quantity:2,reason:'Uma avariada e uma não entregue'};
  const key=randomUUID();
  const receive=()=>app.inject({method:'POST',url:receivePath,headers:write(key),payload:checked});
  const [first,replayed]=await Promise.all([receive(),receive()]);
  assert.equal(first.statusCode,200,first.body);
  assert.equal(replayed.statusCode,200,replayed.body);
  assert.deepEqual(first.json(),replayed.json());
  assert.equal(first.json().accepted_quantity,2);
  assert.equal(first.json().rejected_quantity,1);
  assert.equal(first.json().missing_quantity,1);
  const duplicate=await app.inject({method:'POST',url:receivePath,headers:write(),payload:checked});
  assert.equal(duplicate.statusCode,409,duplicate.body);
  const stock=()=>db.query('SELECT on_hand::text AS on_hand FROM stock_balances WHERE store_id=$1 AND variant_id=$2',[store.id,variant]);
  assert.equal((await stock()).rows[0].on_hand,'2');
  const quality=await app.inject({method:'PUT',url:'/v1/management/purchases/'+purchase.json().id+'/quality',
   headers:write(),payload:{accepted_quantity:3}});
  assert.equal(quality.statusCode,409,'Conferência concluída não altera saldo por formulário separado');
  const purchaseCheck=await db.query('SELECT received_quantity,accepted_quantity,rejected_quantity,missing_quantity FROM purchase_orders WHERE id=$1',[purchase.json().id]);
  assert.deepEqual(purchaseCheck.rows[0],{received_quantity:3,accepted_quantity:2,rejected_quantity:1,missing_quantity:1});
  // Mais duas peças vendáveis para exercitar o retorno parcial.
  const receipt=await app.inject({method:'POST',url:'/v1/stock/receipts',headers:write(),
   payload:{variant_id:variant,quantity:2,reference_id:randomUUID()}});
  assert.equal(receipt.statusCode,201,receipt.body);
  const cash=await app.inject({method:'POST',url:'/v1/cash-sessions',headers:write(),
   payload:{terminal_code:'P0-01',opening_cents:0}});
  assert.equal(cash.statusCode,201,cash.body);
  const sold=await app.inject({method:'POST',url:'/v1/sales',headers:write(),payload:{
   cash_session_id:cash.json().id,lines:[{variant_id:variant,quantity:3,expected_price_cents:1000,expected_price_revision:1}],
   payments:[{method:'cash',amount_cents:3000,confirmed:true}]
  }});
  assert.equal(sold.statusCode,201,sold.body);
  const salePath='/v1/management/sales/by-number/'+sold.json().sale_number;
  const detail=await app.inject({url:salePath,headers});
  assert.equal(detail.statusCode,200,detail.body);
  const line=detail.json().lines[0];
  assert.equal(line.available_to_return,3);
  const refund=(quantity:number,condition:'resellable'|'quarantine',id=randomUUID())=>
   app.inject({method:'POST',url:salePath+'/cash-return',headers:write(id),payload:{
    cash_session_id:cash.json().id,reason:'Devolução após avaliação física',
    items:[{sale_line_id:line.id,quantity,condition}]
   }});
  const refundKey=randomUUID();
  const damaged=await refund(1,'quarantine',refundKey);
  assert.equal(damaged.statusCode,201,damaged.body);
  assert.equal(damaged.json().refunded_cents,1000);
  assert.deepEqual((await refund(1,'quarantine',refundKey)).json(),damaged.json());
  assert.equal((await stock()).rows[0].on_hand,'1','Peça avariada não volta ao vendável');
  const available=(await app.inject({url:salePath,headers})).json().lines[0].available_to_return;
  assert.equal(available,2);
  const [good,excess]=await Promise.all([refund(1,'resellable'),refund(3,'resellable')]);
  assert.deepEqual([good.statusCode,excess.statusCode].sort(),[201,409]);
  assert.equal((await stock()).rows[0].on_hand,'2');
  assert.equal((await app.inject({url:'/v1/sales/'+sold.json().id,headers})).json().status,'partially_returned');
  const remaining=await refund(1,'resellable');
  assert.equal(remaining.statusCode,201,remaining.body);
  assert.equal((await stock()).rows[0].on_hand,'3');
  assert.equal((await app.inject({url:'/v1/sales/'+sold.json().id,headers})).json().status,'returned');
  assert.equal((await refund(1,'resellable')).statusCode,409);
  const movement=await db.query("SELECT count(*)::text AS total FROM cash_movements WHERE store_id=$1 AND kind='refund'",[store.id]);
  assert.equal(movement.rows[0].total,'3');
  const quarantined=await db.query("SELECT sum(quantity)::text AS total FROM cash_return_lines WHERE store_id=$1 AND disposition='quarantine'",[store.id]);
  assert.equal(quarantined.rows[0].total,'1');
  const closed=await app.inject({method:'POST',url:'/v1/cash-sessions/'+cash.json().id+'/close',headers:write(),payload:{counted_cash_cents:0}});
  assert.equal(closed.statusCode,200,closed.body);
 } finally {await app.close();await db.end();}
});
