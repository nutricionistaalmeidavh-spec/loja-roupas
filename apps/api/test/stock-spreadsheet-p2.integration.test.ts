import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from '../src/app.ts';
import {hashPassword,issueSession} from '../src/security.ts';

test('P2: lote atômico, repetição idempotente, conflitos e histórico filtrado', {
 skip:!process.env.TEST_DATABASE_URL&&'PostgreSQL efêmero de QA obrigatório'
},async()=>{
 const db=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const app=buildApp(db);
 try{
  const sid=(await db.query<{id:string}>('INSERT INTO stores(name) VALUES($1) RETURNING id::text',['Loja P2 '+randomUUID()])).rows[0].id;
  const uid=(await db.query<{id:string}>('INSERT INTO users(login,password_hash) VALUES($1,$2) RETURNING id::text',
   ['p2-'+randomUUID(),await hashPassword('Senha-P2-2026-ok')])).rows[0].id;
  await db.query("INSERT INTO user_store_roles(user_id,store_id,role_code) VALUES($1,$2,'manager')",[uid,sid]);
  const {token,tokenHash}=issueSession();
  await db.query("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')",[uid,tokenHash]);
  const headers={authorization:'Bearer '+token,'x-store-id':sid};
  const random=randomUUID().slice(0,8).toUpperCase();
  const created=await app.inject({method:'POST',url:'/v1/catalog/products',headers:{...headers,'idempotency-key':randomUUID()},
   payload:{name:'Casaco P2',category:'Unissex',variants:[
    {sku:'P2-'+random+'-P',color:'Azul',size:'P',price_cents:7500},
    {sku:'P2-'+random+'-M',color:'Azul',size:'M',price_cents:7500}
   ]}});
  assert.equal(created.statusCode,201,created.body);
  const variants=created.json().variants as Array<{id:string;sku:string}>;
  for(const v of variants){
   const rc=await app.inject({method:'POST',url:'/v1/stock/receipts',headers:{...headers,'idempotency-key':randomUUID()},
    payload:{variant_id:v.id,reference_id:randomUUID(),quantity:9,note:'Entrada direta auditada para teste'}});
   assert.equal(rc.statusCode,201,rc.body);
  }
  const list=await app.inject({method:'GET',url:'/v1/stock/spreadsheet?query=P2-'+random,headers});
  assert.equal(list.statusCode,200,list.body);
  const original=list.json().items as Array<{variant_id:string;name:string;category:string;sku:string;color:string;size:string;barcode:string|null;price_cents:number;product_revision:number;variant_revision:number}>;
  assert.equal(original.length,2);
  const items=original.map((r,i)=>({variant_id:r.variant_id,name:'Casaco atualizado',category:r.category,sku:r.sku,
   color:r.color,size:r.size,barcode:r.barcode,price_cents:8900+i*100,
   expected_product_revision:r.product_revision,expected_variant_revision:r.variant_revision}));
  const key=randomUUID();
  const submit=await app.inject({method:'POST',url:'/v1/stock/spreadsheet/bulk-edit',
   headers:{...headers,'idempotency-key':key},payload:{items}});
  assert.equal(submit.statusCode,200,submit.body);
  assert.equal(submit.json().updated,2);
  const replay=await app.inject({method:'POST',url:'/v1/stock/spreadsheet/bulk-edit',
   headers:{...headers,'idempotency-key':key},payload:{items}});
  assert.equal(replay.statusCode,200,replay.body);
  assert.equal(replay.json().replayed,true);
  const stale=await app.inject({method:'POST',url:'/v1/stock/spreadsheet/bulk-edit',
   headers:{...headers,'idempotency-key':randomUUID()},payload:{items}});
  assert.equal(stale.statusCode,409);
  const fresh=await app.inject({method:'GET',url:'/v1/stock/spreadsheet?query=P2-'+random,headers});
  assert.equal(fresh.statusCode,200);
  assert.ok(fresh.json().items.every((v:{name:string;on_hand:number})=>v.name==='Casaco atualizado'&&v.on_hand===9));
  const updated=fresh.json().items as typeof original;
  const shouldRollback=updated.map((r,i)=>({
   variant_id:r.variant_id,name:'NAO GRAVAR',category:r.category,
   sku:i===1?updated[0].sku:r.sku,color:r.color,size:r.size,barcode:r.barcode,
   price_cents:12345,expected_product_revision:r.product_revision,expected_variant_revision:r.variant_revision
  }));
  const duplicate=await app.inject({method:'POST',url:'/v1/stock/spreadsheet/bulk-edit',
   headers:{...headers,'idempotency-key':randomUUID()},payload:{items:shouldRollback}});
  assert.notEqual(duplicate.statusCode,200);
  const noPartial=await app.inject({method:'GET',url:'/v1/stock/spreadsheet?query=P2-'+random,headers});
  assert.ok(noPartial.json().items.every((v:{name:string;price_cents:number})=>v.name==='Casaco atualizado'&&v.price_cents!==12345));
  const movement=await app.inject({method:'GET',url:'/v1/stock/spreadsheet/movements?variant_id='+variants[0].id+'&movement_kind=receipt&operator_id='+uid,headers});
  assert.equal(movement.statusCode,200,movement.body);
  assert.ok(movement.json().total>=1);
  assert.equal(movement.json().items[0].operator_id,uid);
  const supplier=(await db.query<{id:string}>(
   'INSERT INTO suppliers(store_id,name) VALUES($1,$2) RETURNING id::text',[sid,'Fornecedor P2 '+random])).rows[0].id;
  const purchase=(await db.query<{id:string}>(
   'INSERT INTO purchase_orders(store_id,supplier_id,variant_id,quantity,unit_cost_cents) '+
   'VALUES($1,$2,$3,4,3500) RETURNING id::text',[sid,supplier,variants[0].id])).rows[0].id;
  const received=await app.inject({method:'POST',
   url:'/v1/management/purchases/'+purchase+'/receive',
   headers:{...headers,'idempotency-key':randomUUID()},payload:{received_quantity:4,accepted_quantity:4}});
  assert.equal(received.statusCode,200,received.body);
  const purchaseHistory=await app.inject({method:'GET',
   url:'/v1/stock/spreadsheet/movements?supplier_id='+supplier+'&purchase_id='+purchase+
     '&operator_id='+uid+'&from=1990-01-01&to=2100-01-01',headers});
  assert.equal(purchaseHistory.statusCode,200,purchaseHistory.body);
  assert.equal(purchaseHistory.json().total,1);
  assert.equal(purchaseHistory.json().items[0].supplier_id,supplier);
  assert.equal(purchaseHistory.json().items[0].purchase_id,purchase);
  assert.equal(purchaseHistory.json().items[0].operator_id,uid);
  const filters=await app.inject({method:'GET',url:'/v1/stock/spreadsheet/filter-options',headers});
  assert.equal(filters.statusCode,200,filters.body);
  assert.ok(filters.json().suppliers.some((x:{id:string})=>x.id===supplier));
  assert.ok(filters.json().purchases.some((x:{id:string})=>x.id===purchase));
  const reversed=await app.inject({method:'GET',
   url:'/v1/stock/spreadsheet/movements?from=2100-01-01&to=1990-01-01',headers});
  assert.equal(reversed.statusCode,422);
  const none=await app.inject({method:'GET',url:'/v1/stock/spreadsheet/movements?operator_id='+randomUUID(),headers});
  assert.equal(none.statusCode,200);
  assert.equal(none.json().total,0);
  const denied=await app.inject('/v1/stock/spreadsheet/movements');
  assert.equal(denied.statusCode,401);
 }finally{await app.close();await db.end();}
});
