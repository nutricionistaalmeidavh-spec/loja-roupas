import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from '../src/app.ts';
import {hashPassword,issueSession} from '../src/security.ts';

test('P1 planilha canônica: entradas, vendas, devoluções, ajustes e revisão',{
 skip:!process.env.TEST_DATABASE_URL&&'TEST_DATABASE_URL obrigatório em banco efêmero'
},async()=>{
 const db=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const app=buildApp(db);
 try{
  const sid=(await db.query<{id:string}>('INSERT INTO stores(name) VALUES($1) RETURNING id::text',['Planilha QA '+randomUUID()])).rows[0].id;
  const uid=(await db.query<{id:string}>('INSERT INTO users(login,password_hash) VALUES($1,$2) RETURNING id::text',[
    'sheet-'+randomUUID(),await hashPassword('Senha-Planilha-2026-OK')])).rows[0].id;
  await db.query("INSERT INTO user_store_roles(user_id,store_id,role_code) VALUES($1,$2,'manager')",[uid,sid]);
  const {token,tokenHash}=issueSession();
  await db.query("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')",[uid,tokenHash]);
  const headers={authorization:'Bearer '+token,'x-store-id':sid};
  const sku='SHEET-'+randomUUID().slice(0,9).toUpperCase();
  const product=await app.inject({method:'POST',url:'/v1/catalog/products',headers:{...headers,'idempotency-key':randomUUID()},
    payload:{name:'Camisa teste',category:'Feminino',variants:[{sku,color:'Branco',size:'M',price_cents:13990}]}});
  assert.equal(product.statusCode,201,product.body);
  const variant=product.json().variants[0].id as string;
  const unauth=await app.inject('/v1/stock/spreadsheet');
  assert.equal(unauth.statusCode,401);
  const receipt=await app.inject({method:'POST',url:'/v1/stock/receipts',headers:{...headers,'idempotency-key':randomUUID()},
    payload:{variant_id:variant,reference_id:randomUUID(),quantity:9}});
  assert.equal(receipt.statusCode,201,receipt.body);
  await db.query('UPDATE stock_balances SET on_hand=7,revision=revision+1 WHERE store_id=$1 AND variant_id=$2',[sid,variant]);
  await db.query("INSERT INTO stock_movements(store_id,variant_id,source_type,source_id,movement_kind,qty_delta) VALUES($1,$2,'sale',$3,'sale',-2)",[sid,variant,randomUUID()]);
  await db.query('UPDATE stock_balances SET on_hand=8,revision=revision+1 WHERE store_id=$1 AND variant_id=$2',[sid,variant]);
  await db.query("INSERT INTO stock_movements(store_id,variant_id,source_type,source_id,movement_kind,qty_delta) VALUES($1,$2,'sale_return',$3,'return',1)",[sid,variant,randomUUID()]);
  await db.query('UPDATE stock_balances SET on_hand=7,revision=revision+1 WHERE store_id=$1 AND variant_id=$2',[sid,variant]);
  await db.query("INSERT INTO stock_movements(store_id,variant_id,source_type,source_id,movement_kind,qty_delta) VALUES($1,$2,'manager_adjustment',$3,'adjustment',-1)",[sid,variant,randomUUID()]);
  const list=await app.inject({method:'GET',url:'/v1/stock/spreadsheet?query='+encodeURIComponent(sku),headers});
  assert.equal(list.statusCode,200,list.body);
  const row=list.json().items[0];
  assert.equal(row.variant_id,variant);
  assert.equal(row.on_hand,7);
  assert.equal(row.available,7);
  assert.equal(row.entries,9);
  assert.equal(row.sold,2);
  assert.equal(row.returns,1);
  assert.equal(row.adjustments,-1);
  const payload={name:'Camisa atualizada',category:'Feminino',sku,color:'Branco',size:'M',barcode:null,
    price_cents:15990,expected_product_revision:row.product_revision,expected_variant_revision:row.variant_revision};
  const saved=await app.inject({method:'PATCH',url:'/v1/stock/spreadsheet/rows/'+variant,
    headers:{...headers,'idempotency-key':randomUUID()},payload});
  assert.equal(saved.statusCode,200,saved.body);
  assert.equal(saved.json().variant_revision,row.variant_revision+1);
  const stale=await app.inject({method:'PATCH',url:'/v1/stock/spreadsheet/rows/'+variant,
    headers:{...headers,'idempotency-key':randomUUID()},payload});
  assert.equal(stale.statusCode,409);
  const forbiddenStockWrite=await app.inject({method:'PATCH',url:'/v1/stock/spreadsheet/rows/'+variant,
    headers:{...headers,'idempotency-key':randomUUID()},payload:{...payload,on_hand:1000}});
  assert.equal(forbiddenStockWrite.statusCode,400);
  const anotherStore=await app.inject({method:'GET',url:'/v1/stock/spreadsheet',headers:{...headers,'x-store-id':randomUUID()}});
  assert.equal(anotherStore.statusCode,401);
 }finally{await app.close();await db.end();}
});
