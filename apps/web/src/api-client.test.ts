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

test('foto original usa PUT /photo, miniatura privada usa GET /thumbnail',async()=>{
  const {uploadPhoto,fetchProductPhoto}=await import('./api-client.ts');
  const id='b69c72ed-45ac-4e36-8c32-3be1fa475ee9';
  const received:Array<{url:string;method:string|undefined;authorization:unknown;type:unknown}>=[];
  const fake:typeof fetch=async(input,init)=>{
    received.push({url:String(input),method:init?.method,
      authorization:(init?.headers as Record<string,string>)['authorization'],
      type:(init?.headers as Record<string,string>)['content-type']});
    if(init?.method==='PUT')return Response.json({product_id:id,sha256:'mock',content_type:'image/png'});
    return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/webp'}});
  };
  await uploadPhoto(session,id,new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'}),'retry-photo-12345',fake);
  const image=await fetchProductPhoto(session,id,fake);
  assert.equal(image.type,'image/webp');
  assert.deepEqual(received.map(x=>[x.method??'GET',x.url]),[
    ['PUT','/v1/catalog/products/'+id+'/photo'],
    ['GET','/v1/catalog/products/'+id+'/thumbnail'],
  ]);
  assert.equal(received[0].authorization,'Bearer '+session.token);
  assert.equal(received[1].authorization,'Bearer '+session.token);
});

test('categorias e variantes recuperadas respeitam escopo e IDs exatos',async()=>{
 const {listCategories,lookupDraftVariants}=await import('./api-client.ts');
 const id='82df5fca-2c59-49f7-8ac8-38cd1996c229';
 const urls:string[]=[];
 const fake:typeof fetch=async(input,init)=>{
  urls.push(String(input));
  assert.equal((init?.headers as Record<string,string>)['x-store-id'],session.storeId);
  assert.equal((init?.headers as Record<string,string>)['authorization'],'Bearer '+session.token);
  return Response.json(urls.length===1?{categories:['Masculino']}:{items:[],next_cursor:null});
 };
 assert.deepEqual(await listCategories(session,fake),{categories:['Masculino']});
 await lookupDraftVariants(session,[id],fake);
 assert.deepEqual(urls,['/v1/catalog/categories','/v1/catalog/draft-variants?ids='+id]);
});
