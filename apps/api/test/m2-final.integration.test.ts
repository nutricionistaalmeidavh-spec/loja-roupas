import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import sharp from 'sharp';
import { buildApp } from '../src/app.ts';
import { hashPassword, issueSession } from '../src/security.ts';

const dbUrl = process.env.TEST_DATABASE_URL;
test('M2 final: edição otimista, paginação, imagem local e ajuste auditado', {
  skip: !dbUrl && 'Exige PostgreSQL de teste',
}, async () => {
  const pool = new Pool({ connectionString: dbUrl! });
  const app = buildApp(pool);
  try {
    const st = await pool.query<{id:string}>("INSERT INTO stores(name) VALUES ('Loja M2 Final') RETURNING id::text");
    const storeId = st.rows[0].id;
    const us = await pool.query<{id:string}>(
      'INSERT INTO users(login,password_hash) VALUES($1,$2) RETURNING id::text',
      ['m2final-'+randomUUID(),await hashPassword('Senha-M2-Final-2026!')]);
    await pool.query('INSERT INTO user_store_roles(user_id,store_id,role_code) VALUES($1,$2,$3)',[us.rows[0].id,storeId,'manager']);
    const {token,tokenHash}=issueSession();
    await pool.query("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')",[us.rows[0].id,tokenHash]);
    const headers={authorization:'Bearer '+token,'x-store-id':storeId};
    const ids:string[]=[];
    for (let i=0;i<3;i++) {
      const res=await app.inject({method:'POST',url:'/v1/catalog/products',
        headers:{...headers,'idempotency-key':randomUUID()},
        payload:{name:'Teste Fashion '+i,category:'Moda',variants:[{sku:'M2F-'+i+'-'+randomUUID().slice(0,8),
          color:'Azul',size:'M',price_cents:19990}]}});
      assert.equal(res.statusCode,201,res.body);
      ids.push(res.json().id);
    }
    const first=await app.inject({url:'/v1/catalog/products?query=Teste%20Fashion&limit=2',headers});
    assert.equal(first.statusCode,200,first.body);
    assert.equal(first.json().items.length,2);
    assert.ok(first.json().next_cursor);
    const second=await app.inject({url:'/v1/catalog/products?query=Teste%20Fashion&limit=2&cursor='+encodeURIComponent(first.json().next_cursor),headers});
    assert.equal(second.statusCode,200,second.body);
    assert.equal(second.json().items.length,1);
    assert.equal(second.json().next_cursor,null);
    assert.equal(new Set([...first.json().items,...second.json().items].map((p:{id:string})=>p.id)).size,3);

    const edit=await app.inject({method:'PATCH',url:'/v1/catalog/products/'+ids[0],
      headers:{...headers,'idempotency-key':randomUUID()},payload:{name:'Teste Fashion editado',category:'Moda',expected_revision:1}});
    assert.equal(edit.statusCode,200,edit.body);
    assert.equal(edit.json().revision,2);
    const stale=await app.inject({method:'PATCH',url:'/v1/catalog/products/'+ids[0],
      headers:{...headers,'idempotency-key':randomUUID()},payload:{name:'Nome antigo',category:'Moda',expected_revision:1}});
    assert.equal(stale.statusCode,409,stale.body);

    const variantId=first.json().items[0].variants[0].id;
    const price=await app.inject({method:'PATCH',url:'/v1/catalog/variants/'+variantId,
      headers:{...headers,'idempotency-key':randomUUID()},
      payload:{price_cents:23990,expected_revision:1}});
    assert.equal(price.statusCode,200,price.body);
    assert.equal(price.json().price_cents,23990);
    const png=await sharp({create:{width:2,height:2,channels:3,background:'#DDCCBB'}}).png().toBuffer();
    const upload=await app.inject({method:'PUT',url:'/v1/catalog/products/'+ids[0]+'/photo',
      headers:{...headers,'content-type':'image/png','idempotency-key':randomUUID()},payload:png});
    assert.equal(upload.statusCode,200,upload.body);
    const photo=await app.inject({url:'/v1/catalog/products/'+ids[0]+'/photo',headers});
    assert.equal(photo.statusCode,200,photo.body);
    assert.equal(photo.headers['content-type'],'image/png');
    assert.equal(photo.rawPayload.toString('hex'),png.toString('hex'));
    const invalidPhoto=await app.inject({method:'PUT',url:'/v1/catalog/products/'+ids[0]+'/photo',
      headers:{...headers,'content-type':'image/png','idempotency-key':randomUUID()},payload:Buffer.from('not-a-png')});
    assert.equal(invalidPhoto.statusCode,415);

    const receipt=await app.inject({method:'POST',url:'/v1/stock/receipts',
      headers:{...headers,'idempotency-key':randomUUID()},
      payload:{variant_id:variantId,reference_id:randomUUID(),quantity:6,note:'Entrada direta auditada para teste'}});
    assert.equal(receipt.statusCode,201,receipt.body);
    const adjust=await app.inject({method:'POST',url:'/v1/stock/adjustments',
      headers:{...headers,'idempotency-key':randomUUID()},
      payload:{variant_id:variantId,reference_id:randomUUID(),counted_on_hand:4,expected_revision:1,reason:'Conferência gerencial'}});
    assert.equal(adjust.statusCode,201,adjust.body);
    assert.equal(adjust.json().on_hand,4);
    const conflict=await app.inject({method:'POST',url:'/v1/stock/adjustments',
      headers:{...headers,'idempotency-key':randomUUID()},
      payload:{variant_id:variantId,reference_id:randomUUID(),counted_on_hand:5,expected_revision:1,reason:'Conferência antiga'}});
    assert.equal(conflict.statusCode,409,conflict.body);
    const ledger=await app.inject({url:'/v1/stock/movements?variant_id='+variantId,headers});
    assert.equal(ledger.statusCode,200,ledger.body);
    assert.equal(ledger.json().items.length,2);
    assert.equal(ledger.json().items[0].movement_kind,'adjustment');
  } finally { await app.close();await pool.end(); }
});
