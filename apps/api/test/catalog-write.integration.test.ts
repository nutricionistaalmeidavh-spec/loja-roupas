import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { buildApp } from '../src/app.ts';
import { hashPassword, issueSession } from '../src/security.ts';

// Banco de teste separado é OBRIGATÓRIO; jamais executar esse teste com DATABASE_URL de produção.
const connection = process.env.TEST_DATABASE_URL;
test('M2 PostgreSQL: cadastro e recebimento transacionais, isolamento e idempotência',
  {skip:!connection && 'TEST_DATABASE_URL não definido; teste de integração exige banco exclusivo'}, async()=>{
  const pool=new Pool({connectionString:connection!});
  const app=buildApp(pool);
  try {
    const store=await pool.query<{id:string}>(
      "INSERT INTO stores(name) VALUES ($1) RETURNING id::text",['Loja de teste M2']);
    const storeId=store.rows[0].id;
    const user=await pool.query<{id:string}>(
      'INSERT INTO users(login,password_hash) VALUES($1,$2) RETURNING id::text',
      ['qa_'+randomUUID(),await hashPassword('Senha de teste com 15 caracteres')]);
    const userId=user.rows[0].id;
    await pool.query('INSERT INTO user_store_roles(user_id,store_id,role_code) VALUES ($1,$2,$3)',[userId,storeId,'manager']);
    const {token,tokenHash}=issueSession();
    await pool.query("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')",[userId,tokenHash]);
    const headers={'x-store-id':storeId,authorization:`Bearer ${token}`};
    const product={
      name:'Camisa de teste',category:'Masculino',
      variants:[
        {sku:'QA-CAM-'+randomUUID().slice(0,8),color:'Azul',size:'M',price_cents:14990},
        {sku:'QA-CAM-'+randomUUID().slice(0,8),color:'Azul',size:'G',price_cents:14990}
      ]
    };
    const unauth=await app.inject({method:'POST',url:'/v1/catalog/products',payload:product});
    assert.equal(unauth.statusCode,401);
    const idempotencyKey=randomUUID();
    const created=await app.inject({method:'POST',url:'/v1/catalog/products',headers:{...headers,'idempotency-key':idempotencyKey},payload:product});
    assert.equal(created.statusCode,201,created.body);
    assert.equal(created.json().variants.length,2);
    const again=await app.inject({method:'POST',url:'/v1/catalog/products',headers:{...headers,'idempotency-key':idempotencyKey},payload:product});
    assert.equal(again.statusCode,201,again.body);
    assert.equal(again.json().id,created.json().id);
    const mismatch=await app.inject({method:'POST',url:'/v1/catalog/products',headers:{...headers,'idempotency-key':idempotencyKey},payload:{...product,name:'Outro'}});
    assert.equal(mismatch.statusCode,409);
    const variantId=created.json().variants[0].id;
    const referenceId=randomUUID();
    const receipt={variant_id:variantId,reference_id:referenceId,quantity:4,note:'Entrada direta auditada para teste'};
    const stockKey=randomUUID();
    const received=await app.inject({method:'POST',url:'/v1/stock/receipts',headers:{...headers,'idempotency-key':stockKey},payload:receipt});
    assert.equal(received.statusCode,201,received.body);
    assert.equal(received.json().on_hand,4);
    const same=await app.inject({method:'POST',url:'/v1/stock/receipts',headers:{...headers,'idempotency-key':stockKey},payload:receipt});
    assert.equal(same.statusCode,201,same.body);
    assert.equal(same.json().movement_id,received.json().movement_id);
    const doubleReceipt=await app.inject({method:'POST',url:'/v1/stock/receipts',headers:{...headers,'idempotency-key':randomUUID()},payload:receipt});
    assert.equal(doubleReceipt.statusCode,409,doubleReceipt.body);
    const catalog=await app.inject({url:'/v1/catalog/products?query=Camisa',headers});
    assert.equal(catalog.statusCode,200,catalog.body);
    const found=catalog.json().items.find((p:{id:string})=>p.id===created.json().id);
    assert.ok(found);
    assert.equal(found.variants.find((v:{id:string})=>v.id===variantId).available,4);
    const balance=await pool.query<{on_hand:string}>('SELECT on_hand::text FROM stock_balances WHERE store_id=$1 AND variant_id=$2',[storeId,variantId]);
    assert.equal(balance.rows[0].on_hand,'4');
    const events=await pool.query<{count:string}>('SELECT count(*)::text AS count FROM outbox_events WHERE store_id=$1',[storeId]);
    assert.equal(events.rows[0].count,'2');
    const audit=await pool.query<{count:string}>('SELECT count(*)::text AS count FROM audit_logs WHERE store_id=$1',[storeId]);
    assert.equal(audit.rows[0].count,'2');
    const otherStore=await app.inject({url:'/v1/catalog/products',headers:{...headers,'x-store-id':randomUUID()}});
    assert.equal(otherStore.statusCode,401);
  } finally {
    await app.close();
    await pool.end();
  }
});
