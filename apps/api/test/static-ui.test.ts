import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import {registerStaticUi} from '../src/static-ui.ts';

test('API local entrega UI e protege /v1 contra fallback HTML',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'loja-static-'));
 const app=Fastify();
 try{
  await writeFile(path.join(root,'index.html'),'<h1>Local</h1>');
  await writeFile(path.join(root,'app.js'),'console.log(1)');
  registerStaticUi(app,root);
  const index=await app.inject('/');
  assert.equal(index.statusCode,200);
  assert.match(index.body,/Local/);
  assert.match(index.headers['content-type']||'',/text\/html/);
  const script=await app.inject('/app.js');
  assert.equal(script.statusCode,200);
  assert.match(script.headers['content-type']||'',/text\/javascript/);
  assert.equal((await app.inject('/v1/missing')).statusCode,404);
  assert.equal((await app.inject('/missing.js')).statusCode,404);
  const spa=await app.inject('/vitrine/00000000-0000-4000-8000-000000000001');
  assert.equal(spa.statusCode,200);
  assert.match(spa.body,/Local/);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
