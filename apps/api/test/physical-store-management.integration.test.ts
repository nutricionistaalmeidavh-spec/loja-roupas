import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from '../src/app.ts';
import {issueSession} from '../src/security.ts';

const database=process.env.TEST_DATABASE_URL;
test('P1 físico: despesas, clientes e inventário isolados por loja e idempotentes',{
 skip:!database && 'Exige PostgreSQL QA'
},async()=>{
 const db=new Pool({connectionString:database!});
 const app=buildApp(db);
 try{
  const store=(await db.query<{id:string}>("INSERT INTO stores(name) VALUES('Loja Física QA') RETURNING id::text")).rows[0].id;
  const other=(await db.query<{id:string}>("INSERT INTO stores(name) VALUES('Loja Física Outra') RETURNING id::text")).rows[0].id;
  const user=(await db.query<{id:string}>('INSERT INTO users(login,password_hash) VALUES($1,$2) RETURNING id::text',
   ['physical-'+randomUUID(),'integration-fixture'])).rows[0].id;
  await db.query("INSERT INTO user_store_roles VALUES($1,$2,'manager')",[user,store]);
  const {token,tokenHash}=issueSession();
  await db.query("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[user,tokenHash]);
  const common={authorization:'Bearer '+token,'x-store-id':store};
  const write=(key=randomUUID())=>({...common,'idempotency-key':key});
  const expense={category:'Aluguel',description:'Despesa de teste',occurred_on:'2026-11-22',amount_cents:23000};
  const fixedKey=randomUUID();
  const sendExpense=()=>app.inject({method:'POST',url:'/v1/management/expenses',headers:write(fixedKey),payload:expense});
  const first=await sendExpense();
  assert.equal(first.statusCode,201,first.body);
  const retry=await sendExpense();
  assert.equal(retry.statusCode,200,retry.body);
  assert.equal(first.json().id,retry.json().id);
  assert.equal(retry.json().replayed,true);
  const invalid=await app.inject({method:'POST',url:'/v1/management/expenses',headers:write(),
   payload:{...expense,occurred_on:'2026-02-30'}});
  assert.equal(invalid.statusCode,422,invalid.body);
  const balance=await app.inject({url:'/v1/management/operational-result?month=2026-11',headers:common});
  assert.equal(balance.statusCode,200,balance.body);
  assert.equal(balance.json().expenses_cents,23000);
  const customer=await app.inject({method:'POST',url:'/v1/management/customers',headers:write(),
   payload:{name:'Pessoa Cliente QA',phone:'11987654321',marketing_consent:false}});
  assert.equal(customer.statusCode,201,customer.body);
  assert.equal(customer.json().marketing_consent,false);
  const fetched=await app.inject({url:'/v1/management/customers',headers:common});
  assert.equal(fetched.statusCode,200,fetched.body);
  assert.ok(fetched.json().items.some((x:{id:string})=>x.id===customer.json().id));
  const anonymized=await app.inject({method:'POST',url:'/v1/management/customers/'+customer.json().id+'/anonymize',
   headers:write()});
  assert.equal(anonymized.statusCode,200,anonymized.body);
  const after=await db.query('SELECT phone,email,marketing_consent,anonymized_at FROM retail_customers WHERE store_id=$1 AND id=$2',
   [store,customer.json().id]);
  assert.equal(after.rows[0].phone,null);
  assert.equal(after.rows[0].marketing_consent,false);
  assert.ok(after.rows[0].anonymized_at);
  const product=await app.inject({method:'POST',url:'/v1/catalog/products',headers:write(),
   payload:{name:'Camisa de teste',category:'Camisas',variants:[{
    sku:'PH-'+randomUUID().slice(0,8),size:'M',color:'Azul',price_cents:7000}] }});
  assert.equal(product.statusCode,201,product.body);
  const variant=product.json().variants[0].id;
  const receipt=await app.inject({method:'POST',url:'/v1/stock/receipts',headers:write(),
   payload:{variant_id:variant,reference_id:randomUUID(),quantity:8,note:'Reposição de teste'}});
  assert.equal(receipt.statusCode,201,receipt.body);
  const open=await app.inject({method:'POST',url:'/v1/management/inventory-counts',headers:write()});
  assert.equal(open.statusCode,201,open.body);
  const countId=open.json().id;
  const lineUrl='/v1/management/inventory-counts/'+countId+'/lines';
  const record=async(counted:number)=>app.inject({method:'POST',url:lineUrl,headers:write(),
    payload:{variant_id:variant,counted_on_hand:counted}});
  assert.equal((await record(7)).statusCode,201);
  await db.query('UPDATE stock_balances SET on_hand=6,revision=revision+1 WHERE store_id=$1 AND variant_id=$2',[store,variant]);
  const stale=await app.inject({method:'POST',url:'/v1/management/inventory-counts/'+countId+'/close',headers:write()});
  assert.equal(stale.statusCode,409,stale.body);
  // A recontagem atualiza o snapshot antes de autorizar conciliação.
  assert.equal((await record(5)).statusCode,201);
  const closeKey=randomUUID();
  const close=()=>app.inject({method:'POST',url:'/v1/management/inventory-counts/'+countId+'/close',headers:write(closeKey)});
  const done=await close();
  assert.equal(done.statusCode,200,done.body);
  assert.equal(done.json().missing,1);
  const replay=await close();
  assert.equal(replay.statusCode,200,replay.body);
  assert.equal(replay.json().missing,1);
  const stock=await db.query<{on_hand:string}>('SELECT on_hand::text FROM stock_balances WHERE store_id=$1 AND variant_id=$2',[store,variant]);
  assert.equal(stock.rows[0].on_hand,'5');
  const invisible=await db.query('SELECT count(*)::int AS count FROM inventory_count_sessions WHERE store_id=$1',[other]);
  assert.equal(invisible.rows[0].count,0);
  const cross=await app.inject({url:'/v1/management/expenses',headers:{...common,'x-store-id':other}});
  assert.equal(cross.statusCode,401,cross.body);
 }finally{await app.close();await db.end();}
});
