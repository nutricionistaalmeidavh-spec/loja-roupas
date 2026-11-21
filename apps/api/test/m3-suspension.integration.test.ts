import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { buildApp } from '../src/app.ts';
import { hashPassword,issueSession } from '../src/security.ts';
const url=process.env.TEST_DATABASE_URL;
test('M3: suspender e recuperar carrinho sem baixar estoque', {skip:!url&&'PostgreSQL obrigatório'},async()=>{
 const db=new Pool({connectionString:url!}),app=buildApp(db);
 try{
  const st=await db.query<{id:string}>("INSERT INTO stores(name) VALUES('QA Suspensão') RETURNING id::text");
  const store=st.rows[0].id;
  const u=await db.query<{id:string}>("INSERT INTO users(login,password_hash) VALUES($1,$2) RETURNING id::text",
   ['suspender-'+randomUUID(),await hashPassword('Senha-Suspensao-2026!')]);
  await db.query("INSERT INTO user_store_roles(user_id,store_id,role_code) VALUES($1,$2,'manager')",[u.rows[0].id,store]);
  const {token,tokenHash}=issueSession();
  await db.query("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')",[u.rows[0].id,tokenHash]);
  const headers={authorization:'Bearer '+token,'x-store-id':store};
  const write=()=>({...headers,'idempotency-key':randomUUID()});
  const product=await app.inject({method:'POST',url:'/v1/catalog/products',headers:write(),
   payload:{name:'Calça Suspensa',category:'Feminino',variants:[{sku:'SUSP-'+randomUUID().slice(0,8),
    color:'Preto',size:'40',price_cents:20000}]}});
  assert.equal(product.statusCode,201,product.body);
  const variantId=product.json().variants[0].id;
  const recv=await app.inject({method:'POST',url:'/v1/stock/receipts',headers:write(),
   payload:{variant_id:variantId,reference_id:randomUUID(),quantity:2,note:'Entrada direta auditada para teste'}});
  assert.equal(recv.statusCode,201,recv.body);
  const cash=await app.inject({method:'POST',url:'/v1/cash-sessions',headers:write(),
   payload:{terminal_code:'CAIXA-02',opening_cents:0}});
  assert.equal(cash.statusCode,201,cash.body);
  const cashId=cash.json().id;
  const idemp=randomUUID();
  const request={cash_session_id:cashId,lines:[{variant_id:variantId,quantity:1}],note:'Cliente voltará'};
  const draft=await app.inject({method:'POST',url:'/v1/sales/drafts',
   headers:{...headers,'idempotency-key':idemp},payload:request});
  assert.equal(draft.statusCode,201,draft.body);
  const same=await app.inject({method:'POST',url:'/v1/sales/drafts',
   headers:{...headers,'idempotency-key':idemp},payload:request});
  assert.equal(same.json().id,draft.json().id);
  const available=await db.query<{on_hand:string}>('SELECT on_hand::text FROM stock_balances WHERE store_id=$1 AND variant_id=$2',[store,variantId]);
  assert.equal(available.rows[0].on_hand,'2');
  const list=await app.inject({url:'/v1/sales/drafts',headers});
  assert.equal(list.statusCode,200,list.body);
  assert.ok(list.json().items.some((d:{id:string})=>d.id===draft.json().id));
  const resume=await app.inject({method:'POST',url:'/v1/sales/drafts/'+draft.json().id+'/resume',headers:write(),payload:{}});
  assert.equal(resume.statusCode,200,resume.body);
  assert.equal(resume.json().lines[0].variant.id,variantId);
  assert.equal(resume.json().lines[0].quantity,1);
  assert.equal(resume.json().lines[0].variant.available,2);
  const second=await app.inject({method:'POST',url:'/v1/sales/drafts/'+draft.json().id+'/resume',
    headers:write(),payload:{}});
  assert.equal(second.statusCode,409,second.body);
  const after=await app.inject({url:'/v1/sales/drafts',headers});
  assert.ok(!after.json().items.some((d:{id:string})=>d.id===draft.json().id));
 }finally{await app.close();await db.end();}
});
