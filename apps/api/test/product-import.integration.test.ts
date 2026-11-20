import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { buildApp } from '../src/app.ts';
import { hashPassword, issueSession } from '../src/security.ts';

test('importação em lote valida RBAC, atomicidade, estoque e reenvio idempotente',{
  skip: !process.env.TEST_DATABASE_URL && 'Requer PostgreSQL exclusivo de testes'
},async()=>{
  const db=new Pool({connectionString:process.env.TEST_DATABASE_URL});
  const app=buildApp(db);
  try{
    const store=(await db.query<{id:string}>(
      'INSERT INTO stores(name) VALUES($1) RETURNING id::text',['Loja CSV QA '+randomUUID()])).rows[0].id;
    const user=(await db.query<{id:string}>(
      'INSERT INTO users(login,password_hash) VALUES($1,$2) RETURNING id::text',
      ['csv-'+randomUUID(),await hashPassword('Senha-Csv-Import-QA-2026')])).rows[0].id;
    await db.query("INSERT INTO user_store_roles(user_id,store_id,role_code) VALUES($1,$2,'manager')",[user,store]);
    const {token,tokenHash}=issueSession();
    await db.query("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')",
      [user,tokenHash]);
    const headers={authorization:'Bearer '+token,'x-store-id':store};
    const suffix=randomUUID().slice(0,12).toUpperCase();
    const payload={products:[
      {name:'Camisa linho CSV',category:'Feminino',variants:[
        {sku:'CSV-A-'+suffix,color:'Azul',size:'P',price_cents:14990,initial_stock:3},
        {sku:'CSV-B-'+suffix,color:'Azul',size:'M',price_cents:14990,initial_stock:5}
      ]},
      {name:'Vestido CSV',category:'Feminino',variants:[
        {sku:'CSV-C-'+suffix,color:'Preto',size:'G',price_cents:19990,initial_stock:0}
      ]}
    ]};
    const unauth=await app.inject({method:'POST',url:'/v1/catalog/products/import',payload});
    assert.equal(unauth.statusCode,401);
    const key=randomUUID();
    const created=await app.inject({method:'POST',url:'/v1/catalog/products/import',
      headers:{...headers,'idempotency-key':key},payload});
    assert.equal(created.statusCode,201,created.body);
    assert.equal(created.json().products_created,2);
    assert.equal(created.json().variants_created,3);
    assert.equal(created.json().stock_units,8);
    const replay=await app.inject({method:'POST',url:'/v1/catalog/products/import',
      headers:{...headers,'idempotency-key':key},payload});
    assert.equal(replay.statusCode,201,replay.body);
    assert.equal(replay.json().replayed,true);
    const duplicate=await app.inject({method:'POST',url:'/v1/catalog/products/import',
      headers:{...headers,'idempotency-key':randomUUID()},
      payload:{products:[{name:'Inválido',category:'Feminino',variants:[
        {sku:'CSV-D-'+suffix,color:'Areia',size:'M',price_cents:2500,initial_stock:8},
        {sku:'CSV-A-'+suffix,color:'Azul',size:'M',price_cents:2500,initial_stock:8}
      ]}]}});
    assert.equal(duplicate.statusCode,409,duplicate.body);
    const unchanged=await db.query<{count:string}>(
      'SELECT count(*)::text AS count FROM products WHERE store_id=$1',[store]);
    assert.equal(unchanged.rows[0].count,'2');
    const stock=await db.query<{sum:string}>(
      'SELECT coalesce(sum(on_hand),0)::text AS sum FROM stock_balances WHERE store_id=$1',[store]);
    assert.equal(stock.rows[0].sum,'8');
    const wrongStore=await app.inject({method:'POST',url:'/v1/catalog/products/import',
      headers:{...headers,'x-store-id':randomUUID(),'idempotency-key':randomUUID()},payload});
    assert.equal(wrongStore.statusCode,401);
  }finally{await app.close();await db.end();}
});
