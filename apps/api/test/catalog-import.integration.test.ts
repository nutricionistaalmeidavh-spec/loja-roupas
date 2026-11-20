import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from '../src/app.ts';
import {hashPassword,issueSession} from '../src/security.ts';

const connection=process.env.TEST_DATABASE_URL;
test('importação em lote é transacional, auditável, idempotente e rejeita duplicidade',
 {skip:!connection&&'Exige TEST_DATABASE_URL exclusivo de testes'},async()=>{
 const pool=new Pool({connectionString:connection!}),app=buildApp(pool);
 try{
  const store=await pool.query<{id:string}>("INSERT INTO stores(name) VALUES($1) RETURNING id",['Loja Import '+randomUUID()]);
  const storeId=store.rows[0].id;
  const user=await pool.query<{id:string}>('INSERT INTO users(login,password_hash) VALUES($1,$2) RETURNING id',
    ['bulk-'+randomUUID(),await hashPassword('Senha forte para QA import')]);
  await pool.query("INSERT INTO user_store_roles(user_id,store_id,role_code) VALUES($1,$2,'manager')",[user.rows[0].id,storeId]);
  const {token,tokenHash}=issueSession();
  await pool.query("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')",
   [user.rows[0].id,tokenHash]);
  const headers={authorization:'Bearer '+token,'x-store-id':storeId,'idempotency-key':randomUUID()};
  const suffix=randomUUID().slice(0,7).toUpperCase();
  const rows=[
   {name:'Camisa de linho',category:'Feminino',sku:'LIN-'+suffix+'-P',color:'Bege',size:'P',price_cents:14990,initial_stock:3},
   {name:'Camisa de linho',category:'Feminino',sku:'LIN-'+suffix+'-M',color:'Bege',size:'M',price_cents:14990,initial_stock:4}
  ];
  const unauthorized=await app.inject({method:'POST',url:'/v1/catalog/imports',payload:{rows}});
  assert.equal(unauthorized.statusCode,401);
  const created=await app.inject({method:'POST',url:'/v1/catalog/imports',headers,payload:{rows}});
  assert.equal(created.statusCode,201,created.body);
  assert.equal(created.json().products_created,1);
  assert.equal(created.json().variants_created,2);
  assert.equal(created.json().stock_units_received,7);
  const same=await app.inject({method:'POST',url:'/v1/catalog/imports',headers,payload:{rows}});
  assert.equal(same.statusCode,201,same.body);
  assert.deepEqual(same.json().product_ids,created.json().product_ids);
  const catalog=await app.inject({url:'/v1/catalog/products?query='+encodeURIComponent('LIN-'+suffix),headers});
  assert.equal(catalog.statusCode,200,catalog.body);
  const found=catalog.json().items.filter((p:{name:string})=>p.name==='Camisa de linho');
  assert.ok(found.length>=1);
  const imported=found.find((p:{id:string})=>p.id===created.json().product_ids[0]);
  assert.ok(imported);
  assert.equal(imported.variants.find((v:{sku:string})=>v.sku===rows[0].sku).available,3);
  const duplicate=await app.inject({method:'POST',url:'/v1/catalog/imports',headers:{...headers,'idempotency-key':randomUUID()},
   payload:{rows:[
    {name:'Produto válido',category:'Feminino',sku:'OK-'+suffix,color:'Preto',size:'U',price_cents:1500},
    {...rows[0],name:'Produto duplicado'}
   ]}});
  assert.equal(duplicate.statusCode,409,duplicate.body);
  const rollback=await pool.query<{count:string}>('SELECT count(*)::text AS count FROM products WHERE store_id=$1 AND name=$2',
   [storeId,'Produto válido']);
  assert.equal(rollback.rows[0].count,'0');
  const tally=await pool.query<{count:string}>("SELECT count(*)::text AS count FROM audit_logs WHERE store_id=$1 AND action='catalog.product.import'",[storeId]);
  assert.equal(tally.rows[0].count,'1');
 }finally{await app.close();await pool.end();}
});
