import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from '../src/app.ts';
import {issueSession} from '../src/security.ts';

const database=process.env.TEST_DATABASE_URL;
test('entrada direta exige grant, motivo e impede duplicidade', {skip:!database&&'Exige PostgreSQL'},async()=>{
 const db=new Pool({connectionString:database!}); const app=buildApp(db);
 try {
  const store=(await db.query("INSERT INTO stores(name) VALUES('Direct receipt QA') RETURNING id")).rows[0];
  const manager=(await db.query('INSERT INTO users(login,password_hash) VALUES($1,$2) RETURNING id',['direct-manager-'+randomUUID(),'fixture'])).rows[0];
  const stocker=(await db.query('INSERT INTO users(login,password_hash) VALUES($1,$2) RETURNING id',['direct-stocker-'+randomUUID(),'fixture'])).rows[0];
  await db.query("INSERT INTO user_store_roles VALUES($1,$2,'manager')",[manager.id,store.id]);
  await db.query("INSERT INTO user_store_roles VALUES($1,$2,'stocker')",[stocker.id,store.id]);
  async function token(userId:string){const t=issueSession();await db.query("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[userId,t.tokenHash]);return t.token;}
  const admin=await token(manager.id),operator=await token(stocker.id);
  const h=(token:string,key=randomUUID())=>({authorization:'Bearer '+token,'x-store-id':store.id,'idempotency-key':key});
  const p=await app.inject({method:'POST',url:'/v1/catalog/products',headers:h(admin),payload:{name:'Blusa',category:'Blusas',variants:[{sku:'DIR-'+randomUUID().slice(0,8),size:'M',color:'Azul',price_cents:1000}]}});
  assert.equal(p.statusCode,201,p.body);const variant=p.json().variants[0].id;
  const payload={variant_id:variant,quantity:3,reference_id:randomUUID(),note:'Estoque inicial conferido fora do fluxo'};
  const denied=await app.inject({method:'POST',url:'/v1/stock/receipts',headers:h(operator),payload});
  assert.equal(denied.statusCode,403);
  const grant=await app.inject({method:'PUT',url:'/v1/stock/direct-receipt/grants/'+stocker.id,headers:h(admin),payload:{enabled:true}});
  assert.equal(grant.statusCode,200,grant.body);
  const noReason=await app.inject({method:'POST',url:'/v1/stock/receipts',headers:h(operator),payload:{...payload,note:'curto'}});
  assert.equal(noReason.statusCode,400);
  const key=randomUUID();const receipt=()=>app.inject({method:'POST',url:'/v1/stock/receipts',headers:h(operator,key),payload});
  const first=await receipt();assert.equal(first.statusCode,201,first.body);
  assert.deepEqual((await receipt()).json(),first.json());
  const stock=await db.query('SELECT on_hand FROM stock_balances WHERE store_id=$1 AND variant_id=$2',[store.id,variant]);
  assert.equal(Number(stock.rows[0].on_hand),3);
  const reversePath='/v1/stock/direct-receipt/'+first.json().movement_id+'/reverse';
  const reversed=await app.inject({method:'POST',url:reversePath,headers:h(admin),payload:{reason:'Entrada registrada em duplicidade no inventário'}});
  assert.equal(reversed.statusCode,200,reversed.body);
  assert.equal(reversed.json().on_hand,0);
  const repeat=await app.inject({method:'POST',url:reversePath,headers:h(admin),payload:{reason:'Entrada registrada em duplicidade no inventário'}});
  assert.equal(repeat.statusCode,409,repeat.body);
  const revoke=await app.inject({method:'PUT',url:'/v1/stock/direct-receipt/grants/'+stocker.id,headers:h(admin),payload:{enabled:false}});
  assert.equal(revoke.statusCode,200,revoke.body);
  assert.equal((await app.inject({method:'POST',url:'/v1/stock/receipts',headers:h(operator),payload:{...payload,reference_id:randomUUID()}})).statusCode,403);
 } finally {await app.close();await db.end();}
});
