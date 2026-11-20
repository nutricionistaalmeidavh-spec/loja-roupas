import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';

test('a raiz mostra landing premium, responsiva e dialog real de acesso',async()=>{
 const response=await worker.fetch(new Request('https://loja-roupas-vitrine.example/'),{});
 assert.equal(response.status,200);
 assert.match(response.headers.get('content-type')||'',/text\/html/);
 const html=await response.text();
 assert.match(html,/Loja Roupas/i);
 assert.match(html,/<dialog\b[^>]*id="accessDialog"/);
 assert.match(html,/Acessar minha loja/);
 assert.match(html,/name="storeSlug"/);
 assert.match(html,/name="email"/);
 assert.match(html,/name="password"/);
 assert.match(html,/\/v1\/portal\/login/);
 assert.match(html,/pdv-artisys\.sistema-artisys\.workers\.dev\/admin/);
 assert.match(html,/name="viewport"/);
 assert.doesNotMatch(html,/route_not_found/);
 assert.match(response.headers.get('content-security-policy')||'',/script-src 'nonce-/);
});
test('página principal não revela dados privados nem credenciais',async()=>{
 const response=await worker.fetch(new Request('https://loja-roupas-vitrine.example/'),{});
 const html=await response.text();
 assert.doesNotMatch(html,/PLATFORM_ADMIN_TOKEN|syncKey|sync_hash|ACTIVATION_PEPPER/);
 assert.doesNotMatch(html,/demo@|senha123/i);
});
test('rotas do portal só aceitam sessão autenticada',async()=>{
 const r=await worker.fetch(new Request('https://loja-roupas-vitrine.example/v1/portal/me'),{DB:{}});
 assert.equal(r.status,401);
 const signin=await worker.fetch(new Request('https://loja-roupas-vitrine.example/v1/portal/login',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({slug:'a',email:'invalido',password:'curta'})
 }),{DB:{}});
 assert.equal(signin.status,400);
});
