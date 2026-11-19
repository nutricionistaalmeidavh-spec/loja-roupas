import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from '../src/app.ts';
import {issueSession} from '../src/security.ts';

const connection = process.env.TEST_DATABASE_URL;
test('vitrine opt-in, gestão isolada e reservas concorrentes no estoque canônico', {
  skip:!connection && 'Exige PostgreSQL de teste',
}, async () => {
  const db = new Pool({connectionString:connection!});
  const app = buildApp(db);
  try {
    const {rows:[store,otherStore]} = await db.query(
      "INSERT INTO stores(name) VALUES('Vitrine QA'),('Outra loja QA') RETURNING id");
    const {rows:[user]} = await db.query('INSERT INTO users(login,password_hash) VALUES($1,$2) RETURNING id',
      ['operations-'+randomUUID(),'integration-fixture']);
    const {token, tokenHash} = issueSession();
    await db.query("INSERT INTO user_store_roles VALUES($1,$2,'manager')", [user.id,store.id]);
    await db.query("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [user.id,tokenHash]);
    const headers = {authorization:'Bearer '+token,'x-store-id':store.id};
    const write = (key:string=randomUUID()) => ({...headers,'idempotency-key':key});
    const created = await app.inject({method:'POST',url:'/v1/catalog/products',headers:write(),
      payload:{name:'Camisa QA',category:'Camisas',variants:[{sku:'QA-01',size:'M',color:'Preta',price_cents:1234}]}});
    assert.equal(created.statusCode,201,created.body);
    const variantId = created.json().variants[0].id;
    const received = await app.inject({method:'POST',url:'/v1/stock/receipts',headers:write(),
      payload:{variant_id:variantId,reference_id:randomUUID(),quantity:1}});
    assert.equal(received.statusCode,201,received.body);
    const storefront = () => app.inject({url:'/v1/storefront/'+store.id});
    const hidden = await storefront();
    assert.equal(hidden.statusCode,200,hidden.body);
    assert.deepEqual(hidden.json().items,[]);
    const publishUrl = '/v1/management/storefront/variants/'+variantId;
    assert.equal((await app.inject({method:'PUT',url:publishUrl,payload:{published:true}})).statusCode,401);
    const published = await app.inject({method:'PUT',url:publishUrl,headers:write(),payload:{published:true}});
    assert.equal(published.statusCode,200,published.body);
    assert.deepEqual((await storefront()).json().items,[{
      id:variantId,name:'Camisa QA',color:'Preta',size:'M',price_cents:'1234',available:true,
    }]);
    assert.deepEqual((await app.inject({url:'/v1/storefront/'+otherStore.id})).json().items,[]);
    const firstKey = randomUUID();
    const keys = [firstKey,randomUUID()];
    const hold = (key:string) => app.inject({method:'POST',url:'/v1/stock/holds',headers:write(key),
      payload:{variant_id:variantId,quantity:1}});
    const results = await Promise.all(keys.map(hold));
    assert.deepEqual(results.map(response=>response.statusCode).sort(),[201,409]);
    const winner = results.findIndex(response=>response.statusCode===201);
    const id = results[winner].json().id;
    assert.equal((await hold(keys[winner])).json().id,id);
    assert.equal((await storefront()).json().items[0].available,false);
    const release = await app.inject({method:'POST',url:'/v1/stock/holds/'+id+'/release',headers:write()});
    assert.equal(release.statusCode,200,release.body);
    assert.equal((await storefront()).json().items[0].available,true);
    const balances = await db.query('SELECT on_hand,reserved FROM stock_balances WHERE store_id=$1 AND variant_id=$2',
      [store.id,variantId]);
    assert.deepEqual(balances.rows,[{on_hand:'1',reserved:'0'}]);
    const unpublish = await app.inject({method:'PUT',url:publishUrl,headers:write(),payload:{published:false}});
    assert.equal(unpublish.statusCode,200,unpublish.body);
    assert.deepEqual((await storefront()).json().items,[]);

    const supplierKey = randomUUID();
    const supplier = await app.inject({method:'POST',url:'/v1/management/suppliers',headers:write(supplierKey),
      payload:{name:'  Fornecedor QA  '}});
    assert.equal(supplier.statusCode,201,supplier.body);
    const replay = await app.inject({method:'POST',url:'/v1/management/suppliers',headers:write(supplierKey),
      payload:{name:'Fornecedor QA'}});
    assert.deepEqual(replay.json(),supplier.json());
    const suppliers = await app.inject({url:'/v1/management/suppliers',headers});
    assert.deepEqual(suppliers.json().suppliers,[supplier.json()]);
    const isolated = await app.inject({url:'/v1/management/suppliers',headers:{...headers,'x-store-id':otherStore.id}});
    assert.equal(isolated.statusCode,401,isolated.body);
  } finally {
    await app.close();
    await db.end();
  }
});
