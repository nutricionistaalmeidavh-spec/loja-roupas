import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from '../src/app.ts';
import {hashPassword,issueSession} from '../src/security.ts';

test('P0-P2 PostgreSQL: cursor catálogo e planilha, busca exata e limites por loja',{
 skip:!process.env.TEST_DATABASE_URL&&'Exige PostgreSQL de teste'
},async()=>{
 const db=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const app=buildApp(db);
 try{
  const store=(await db.query<{id:string}>('INSERT INTO stores(name) VALUES($1) RETURNING id::text',['Paginação '+randomUUID()])).rows[0].id;
  const user=(await db.query<{id:string}>('INSERT INTO users(login,password_hash) VALUES($1,$2) RETURNING id::text',[
   'pages-'+randomUUID(),await hashPassword('Senha-Paginacao-2026')])).rows[0].id;
  await db.query("INSERT INTO user_store_roles(user_id,store_id,role_code) VALUES($1,$2,'manager')",[user,store]);
  const {token,tokenHash}=issueSession();
  await db.query("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')",[user,tokenHash]);
  const headers={authorization:'Bearer '+token,'x-store-id':store};
  const prefix=randomUUID().slice(0,8).toUpperCase(),ids:string[]=[];
  for(let i=0;i<3;i++){
   const r=await app.inject({method:'POST',url:'/v1/catalog/products',
    headers:{...headers,'idempotency-key':randomUUID()},
    payload:{name:'Camisa Paginação '+prefix,category:'Casual',variants:[{
     sku:'PAG-'+prefix+'-'+i,color:'Azul',size:String(i),price_cents:9900
    }]}});
   assert.equal(r.statusCode,201,r.body);
   ids.push(r.json().id);
  }
  const catalogIds:string[]=[];
  let cursor:string|null=null;
  for(let i=0;i<3;i++){
   const path:string='/v1/catalog/products?limit=1&query='+encodeURIComponent('Paginação '+prefix)+
    (cursor?'&cursor='+encodeURIComponent(cursor):'');
   const r: Awaited<ReturnType<typeof app.inject>>=await app.inject({url:path,headers});
   assert.equal(r.statusCode,200,r.body);
   assert.equal(r.json().items.length,1);
   catalogIds.push(r.json().items[0].id);
   cursor=r.json().next_cursor;
  }
  assert.equal(new Set(catalogIds).size,3);
  assert.equal(cursor,null);
  for(const id of ids){
   const exact=await app.inject({url:'/v1/catalog/products/'+id,headers});
   assert.equal(exact.statusCode,200,exact.body);
   assert.equal(exact.json().item.id,id);
  }
  const sheetIds:string[]=[];
  let sheetCursor:string|null=null;
  for(let i=0;i<3;i++){
   const path:string='/v1/stock/spreadsheet?limit=1&query='+encodeURIComponent(prefix)+
    (sheetCursor?'&cursor='+encodeURIComponent(sheetCursor):'');
   const r: Awaited<ReturnType<typeof app.inject>>=await app.inject({url:path,headers});
   assert.equal(r.statusCode,200,r.body);
   assert.equal(r.json().items.length,1);
   sheetIds.push(r.json().items[0].variant_id);
   sheetCursor=r.json().next_cursor;
  }
  assert.equal(new Set(sheetIds).size,3);
  assert.equal(sheetCursor,null);
  const invalid=await app.inject({url:'/v1/stock/spreadsheet?cursor=broken-cursor',headers});
  assert.equal(invalid.statusCode,400,invalid.body);
  const other=await app.inject({url:'/v1/catalog/products/'+ids[0],headers:{...headers,'x-store-id':randomUUID()}});
  assert.equal(other.statusCode,401);
 }finally{await app.close();await db.end();}
});
