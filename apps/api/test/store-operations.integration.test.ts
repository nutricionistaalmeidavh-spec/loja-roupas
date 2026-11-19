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
    const productId = created.json().id;
    const publicPhoto='/v1/storefront/'+store.id+'/products/'+productId+'/photo';
    const original=Buffer.from('00'.repeat(16),'hex');
    const thumb=Buffer.from('ab'.repeat(16),'hex');
    await db.query(`INSERT INTO product_photos (store_id,product_id,content_type,image_bytes,sha256,thumb_bytes,thumb_type)
      VALUES($1,$2,'image/png',$3,repeat('a',64),$4,'image/webp')`,[store.id,productId,original,thumb]);
    assert.equal((await app.inject({url:publicPhoto})).statusCode,404);
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
      id:variantId,name:'Camisa QA',color:'Preta',size:'M',price_cents:'1234',available:true,photo_url:publicPhoto,
    }]);
    assert.deepEqual((await app.inject({url:'/v1/storefront/'+otherStore.id})).json().items,[]);
    const publicImage=await app.inject({url:publicPhoto});
    assert.equal(publicImage.headers['content-type'],'image/webp');
    assert.deepEqual(publicImage.rawPayload,thumb);
    assert.equal((await app.inject({url:'/v1/storefront/'+otherStore.id+'/products/'+productId+'/photo'})).statusCode,404);
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
    const submission = {request_id:randomUUID(),lines:[{variant_id:variantId,quantity:1}]};
    const submit = () => app.inject({method:'POST',url:'/v1/storefront/'+store.id+'/pickup-orders',payload:submission});
    assert.equal((await submit()).statusCode,404);
    const enable = await app.inject({method:'PUT',url:'/v1/management/storefront/pickup',headers:write(),payload:{enabled:true}});
    assert.equal(enable.statusCode,200,enable.body);
    const requested = await submit();
    assert.equal(requested.statusCode,201,requested.body);
    assert.deepEqual((await submit()).json(),requested.json());
    assert.equal((await storefront()).json().items[0].available,true);
    const idOrder = requested.json().id;
    const pickup = await app.inject({url:'/v1/pickup-orders/'+idOrder,headers});
    assert.equal(pickup.statusCode,200,pickup.body);
    assert.deepEqual(pickup.json().lines,submission.lines);
    assert.equal((await app.inject({url:'/v1/pickup-orders/'+idOrder})).statusCode,401);
    const opened = await app.inject({method:'POST',url:'/v1/cash-sessions',headers:write(),
      payload:{terminal_code:'RETIRADA-01',opening_cents:0}});
    assert.equal(opened.statusCode,201,opened.body);
    const saleBody = {cash_session_id:opened.json().id,pickup_order_id:idOrder,
      lines:[{...submission.lines[0],expected_price_cents:1234,expected_price_revision:1}],
      payments:[{method:'cash',amount_cents:1234,confirmed:true}]};
    const sell = (key:string) => app.inject({method:'POST',url:'/v1/sales',headers:write(key),payload:saleBody});
    const saleKey = randomUUID();
    const sold = await sell(saleKey);
    assert.equal(sold.statusCode,201,sold.body);
    assert.deepEqual((await sell(saleKey)).json(),sold.json());
    const duplicateSale = await sell(randomUUID());
    assert.equal(duplicateSale.statusCode,409);
    assert.equal(duplicateSale.json().code,'ORDER_SOLD');
    assert.equal((await storefront()).json().items[0].available,false);

    const salePath = '/v1/management/sales/by-number/'+sold.json().sale_number;
    const saleForReturn = await app.inject({url:salePath,headers});
    assert.equal(saleForReturn.statusCode,200,saleForReturn.body);
    assert.equal(saleForReturn.json().cash_only,true);
    const refundKey = randomUUID();
    const refund = (key:string) => app.inject({method:'POST',url:salePath+'/cash-return',headers:write(key),
      payload:{cash_session_id:opened.json().id,reason:'Cliente devolveu a peça em condição de venda'}});
    const refunded = await refund(refundKey);
    assert.equal(refunded.statusCode,201,refunded.body);
    assert.equal(refunded.json().expected_cash_cents,0);
    assert.equal(refunded.json().refunded_cents,1234);
    assert.deepEqual((await refund(refundKey)).json(),refunded.json());
    assert.equal((await refund(randomUUID())).statusCode,409);
    assert.equal((await storefront()).json().items[0].available,true);
    const summary = await app.inject({url:'/v1/management/sales-summary',headers});
    assert.equal(summary.statusCode,200,summary.body);
    assert.equal(summary.json().days[0].refunded_cents,'1234');
    assert.equal(summary.json().days[0].gross_cents,'1234');
    const returnedSale = await app.inject({url:'/v1/sales/'+sold.json().id,headers});
    assert.equal(returnedSale.json().status,'returned');

    const print = await app.inject({method:'POST',url:'/v1/sales/'+sold.json().id+'/print-requests',
      headers:write(),payload:{paper_mm:80}});
    assert.equal(print.statusCode,201,print.body);
    const findPrint = () => app.inject({url:'/v1/management/print-queue',headers});
    assert.equal((await findPrint()).json().jobs[0].id,print.json().id);
    const completeKey = randomUUID();
    const complete = () => app.inject({method:'POST',url:'/v1/management/print-queue/'+print.json().id+'/complete',
      headers:write(completeKey)});
    assert.equal((await complete()).statusCode,200);
    assert.equal((await complete()).statusCode,200);
    assert.deepEqual((await findPrint()).json().jobs,[]);

    const pendingPickup = await app.inject({method:'POST',url:'/v1/storefront/'+store.id+'/pickup-orders',
      payload:{...submission,request_id:randomUUID()}});
    assert.equal(pendingPickup.statusCode,201,pendingPickup.body);
    const cancelledId = pendingPickup.json().id;
    const publicStatus = () => app.inject({url:'/v1/storefront/'+store.id+'/pickup-orders/'+cancelledId+'/status'});
    assert.deepEqual((await publicStatus()).json(),{status:'pending'});
    const listOrders = () => app.inject({url:'/v1/management/pickup-orders',headers});
    assert.deepEqual((await listOrders()).json().orders.map((row:{id:string})=>row.id),[cancelledId]);
    const cancelled = await app.inject({method:'POST',url:'/v1/management/pickup-orders/'+cancelledId+'/cancel',headers:write()});
    assert.equal(cancelled.statusCode,200,cancelled.body);
    assert.deepEqual((await publicStatus()).json(),{status:'cancelled'});
    assert.deepEqual((await listOrders()).json().orders,[]);
    const blockedSale = await app.inject({method:'POST',url:'/v1/sales',headers:write(),
      payload:{...saleBody,pickup_order_id:cancelledId}});
    assert.equal(blockedSale.statusCode,409);
    assert.equal(blockedSale.json().code,'ORDER_CANCELLED');

    const unpublish = await app.inject({method:'PUT',url:publishUrl,headers:write(),payload:{published:false}});
    assert.equal(unpublish.statusCode,200,unpublish.body);
    assert.equal((await app.inject({url:publicPhoto})).statusCode,404);
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
    const purchase=await app.inject({method:'POST',url:'/v1/management/purchases',headers:write(),
      payload:{supplier_id:supplier.json().id,variant_id:variantId,quantity:4,unit_cost_cents:500}});
    assert.equal(purchase.statusCode,201,purchase.body);
    const receive=(key:string)=>app.inject({method:'POST',url:'/v1/management/purchases/'+purchase.json().id+'/receive',
      headers:write(key)});
    const receiveKey=randomUUID();
    const outcomes=await Promise.all([receive(receiveKey),receive(receiveKey)]);
    assert.deepEqual(outcomes.map(result=>result.statusCode),[200,200]);
    assert.deepEqual(outcomes[0].json(),outcomes[1].json());
    assert.equal((await receive(randomUUID())).statusCode,409);
    const updated=await db.query('SELECT on_hand FROM stock_balances WHERE store_id=$1 AND variant_id=$2',[store.id,variantId]);
    assert.equal(updated.rows[0].on_hand,'5');
    const intelligence='/v1/management/intelligence';
    const prefs={target_cents:20000,low_stock_limit:5,widgets:['seasonality','collections','suppliers','stock']};
    const prefsKey=randomUUID();
    const savePrefs=()=>app.inject({method:'PUT',url:intelligence,headers:write(prefsKey),payload:prefs});
    assert.equal((await savePrefs()).statusCode,200);
    assert.deepEqual((await savePrefs()).json(),prefs);
    const collection=await app.inject({method:'PUT',url:intelligence+'/products/'+productId+'/collection',
      headers:write(),payload:{collection:'Verão QA'}});
    assert.equal(collection.statusCode,200,collection.body);
    const dashboard=await app.inject({url:intelligence,headers});
    assert.equal(dashboard.statusCode,200,dashboard.body);
    const analytics=dashboard.json();
    assert.deepEqual(analytics.preferences,prefs);
    assert.equal(analytics.months.length,12);
    assert.equal(analytics.daily.length,29);
    assert.equal(analytics.months.at(-1).gross_cents,'1234');
    assert.equal(analytics.months.at(-1).refunded_cents,'1234');
    assert.equal(analytics.forecast.estimate_cents,null);
    assert.equal(analytics.low_stock[0].available,'5');
    assert.equal(analytics.suppliers[0].received,1);
    assert.equal(analytics.suppliers[0].average_days,null);
    assert.equal((await app.inject({url:intelligence,headers:{...headers,'x-store-id':otherStore.id}})).statusCode,401);
    const isolated = await app.inject({url:'/v1/management/suppliers',headers:{...headers,'x-store-id':otherStore.id}});
    assert.equal(isolated.statusCode,401,isolated.body);
  } finally {
    await app.close();
    await db.end();
  }
});
