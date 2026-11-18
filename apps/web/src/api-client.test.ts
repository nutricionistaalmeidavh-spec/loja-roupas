import test from 'node:test';
import assert from 'node:assert/strict';
import { login, listCatalog, createProduct, receiveStock, ApiError } from './api-client.ts';

const session={token:'secret-token-in-memory',storeId:'a7eec688-f0d4-4190-9bc4-18d87963ab83',roles:['manager']};
test('login envia credenciais à API sem expor storeId arbitrário ou gravar token no navegador',async()=>{
  let called='';
  const fake:typeof fetch=async (input, init)=>{
    called=String(input);
    assert.equal(init?.method,'POST');
    assert.equal(init?.headers && (init.headers as Record<string,string>)['content-type'],'application/json');
    return Response.json({token:'opaque-token',expires_at:'2099-01-01T00:00:00Z',stores:[{store_id:session.storeId,roles:['manager']}]});
  };
  const result=await login('ana','password',fake);
  assert.equal(called,'/v1/auth/sessions');
  assert.equal(result.token,'opaque-token');
  assert.equal(result.stores[0].store_id,session.storeId);
});
test('catálogo usa loja e bearer autorizado, com cache desativado',async()=>{
  const fake:typeof fetch=async (input,init)=>{
    assert.equal(String(input),'/v1/catalog/products?query=camisa&limit=50');
    assert.equal((init?.headers as Record<string,string>)['authorization'], 'Bearer '+session.token);
    assert.equal((init?.headers as Record<string,string>)['x-store-id'],session.storeId);
    assert.equal(init?.cache,'no-store');
    return Response.json({items:[],next_cursor:null});
  };
  assert.deepEqual(await listCatalog(session,'camisa',fake),{items:[],next_cursor:null});
});
test('escritas exigem mesma chave idempotente e escopo de loja',async()=>{
  const calls:string[]=[];
  const fake:typeof fetch=async (input,init)=>{
    calls.push(String(input));
    assert.equal((init?.headers as Record<string,string>)['idempotency-key'],'uuid-retry-12345');
    assert.equal((init?.headers as Record<string,string>)['x-store-id'],session.storeId);
    return Response.json({id:'new',variants:[]},{status:201});
  };
  await createProduct(session,{name:'Blusa',category:'Feminino',variants:[{sku:'BL-AZ-M',color:'Azul',size:'M',price_cents:9000}]},'uuid-retry-12345',fake);
  await receiveStock(session,{variant_id:'123',reference_id:'456',quantity:3},'uuid-retry-12345',fake);
  assert.deepEqual(calls,['/v1/catalog/products','/v1/stock/receipts']);
});
test('erros de autenticação não são interpretados como catálogo vazio',async()=>{
  const fake:typeof fetch=async()=>Response.json({code:'UNAUTHORIZED',message:'Sem sessão'},{status:401});
  await assert.rejects(()=>listCatalog(session,'',fake),(err:unknown)=>err instanceof ApiError && err.status===401);
});
