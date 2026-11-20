import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import type {Pool} from 'pg';
import {registerAuth} from '../src/auth.ts';
import {registerStaticUi} from '../src/static-ui.ts';

/** Regressão: instalador Windows abre GET / sem token antes do primeiro login.
 * O frontend estático deve ser público; recursos e dados /v1 continuam protegidos.
 */
test('Windows: tela de login e assets são públicos, API continua protegida',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'loja-auth-static-'));
 const app=Fastify({logger:false});
 try{
  await mkdir(path.join(root,'assets'));
  await writeFile(path.join(root,'index.html'),'<h1>Bem-vindo à sua loja</h1>');
  await writeFile(path.join(root,'assets','main.js'),'console.log("loja");');
  const neverQuery=async()=>{throw new Error('Auth DB query must not run for anonymous static asset');};
  registerAuth(app,{query:neverQuery} as unknown as Pick<Pool,'query'>);
  app.get('/v1/protected-example',async()=>({secret:'must not leak'}));
  registerStaticUi(app,root);
  for(const url of ['/', '/assets/main.js','/vitrine/00000000-0000-4000-8000-000000000001']){
   const result=await app.inject({method:'GET',url});
   assert.equal(result.statusCode,200,url+': '+result.body);
   assert.doesNotMatch(result.body,/Autenticação necessária/);
  }
  const rootHead=await app.inject({method:'HEAD',url:'/'});
  assert.equal(rootHead.statusCode,200,'HEAD de arquivo estático é público');
  const protectedApi=await app.inject({method:'GET',url:'/v1/protected-example'});
  assert.equal(protectedApi.statusCode,401);
  assert.doesNotMatch(protectedApi.body,/must not leak/);
  const privatePost=await app.inject({method:'POST',url:'/v1/auth/sessions/revoke'});
  assert.equal(privatePost.statusCode,401);
  const unknownApi=await app.inject({method:'GET',url:'/v1/unknown-file'});
  assert.equal(unknownApi.statusCode,404,'fallback SPA nunca expõe rota /v1');
  const missingJs=await app.inject({method:'GET',url:'/assets/missing.js'});
  assert.equal(missingJs.statusCode,404,'não retornar HTML para arquivos JS inexistentes');
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
