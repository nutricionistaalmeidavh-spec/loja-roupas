import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnerCredentials,verifyOwnerPassword,portalRoute} from '../portal.mjs';

test('senha forte é armazenada exclusivamente como hash PBKDF2 com sal aleatório',async()=>{
 const created=await createOwnerCredentials();
 assert.match(created.initialPassword,/^[a-f0-9]{40,}$/);
 assert.match(created.salt,/^[a-f0-9]{32}$/);
 assert.match(created.hash,/^[a-f0-9]{64}$/);
 assert.ok(!created.hash.includes(created.initialPassword));
 assert.equal(await verifyOwnerPassword(created.initialPassword,created.salt,created.hash),true);
 assert.equal(await verifyOwnerPassword('outra-senha',created.salt,created.hash),false);
});
test('login válido cria cookie HttpOnly e painel não aceita outras lojas',async()=>{
 const credential=await createOwnerCredentials();
 const record={id:'tenant-1',slug:'boutique-a',name:'Boutique A',installation_id:'loja-device-111'};
 const other={id:'tenant-2',slug:'boutique-b',name:'Boutique B',installation_id:'loja-device-222'};
 const sessions=new Map(),attempts=new Map();
 const db={
  prepare(sql){
   let params=[];
   const stmt={bind(...v){params=v;return stmt;},
    async first(){
     if(sql.includes('FROM tenants t JOIN tenant_owners')){
      if(params[0]===record.slug && params[1]==='dona@example.com')
       return {...record,email_normalized:'dona@example.com',password_salt:credential.salt,password_hash:credential.hash};
      return null;
     }
     if(sql.includes('FROM tenant_sessions s JOIN tenants')){
      const active=sessions.get(params[0]);
      return active?{...record,owner_email:'dona@example.com',expires_at:active.expires_at}:null;
     }
     if(sql.includes('FROM portal_login_attempts'))return attempts.get(params[0])||null;
     if(sql.includes('FROM variants'))return {total:0};
     if(sql.includes('FROM pickup_orders'))return {total:0};
     return null;
    },
    async run(){
     if(sql.startsWith('INSERT INTO tenant_sessions'))sessions.set(params[0],{tenant_id:params[1],expires_at:params[3]});
     if(sql.startsWith('DELETE FROM tenant_sessions'))sessions.delete(params[0]);
     if(sql.startsWith('DELETE FROM portal_login_attempts'))attempts.delete(params[0]);
     if(sql.startsWith('INSERT INTO portal_login_attempts'))attempts.set(params[0],{attempts:(attempts.get(params[0])?.attempts||0)+1,last_at:new Date().toISOString()});
     return {meta:{changes:1}};
    },
    async all(){return {results:[]};}
   };return stmt;
  }
 };
 const env={DB:db,LICENSE_CENTER:{fetch:async()=>Response.json({active:true,product:'LOJA_ROUPAS'})}};
 const post=(body)=>new Request('https://example.test/v1/portal/login',{
  method:'POST',headers:{'content-type':'application/json','origin':'https://example.test'},body:JSON.stringify(body)
 });
 const invalid=await portalRoute(post({slug:'boutique-b',email:'dona@example.com',password:credential.initialPassword}),env,new URL('https://example.test/v1/portal/login'),async()=>true);
 assert.equal(invalid.status,401);
 const logged=await portalRoute(post({slug:'boutique-a',email:'dona@example.com',password:credential.initialPassword}),env,new URL('https://example.test/v1/portal/login'),async()=>true);
 assert.equal(logged.status,200);
 const cookie=logged.headers.get('set-cookie');
 assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
 const user=await portalRoute(new Request('https://example.test/v1/portal/me',{headers:{cookie:cookie.split(';')[0]}}),env,new URL('https://example.test/v1/portal/me'),async()=>true);
 assert.equal(user.status,200);
 assert.equal((await user.json()).tenant.slug,'boutique-a');
 const logout=await portalRoute(new Request('https://example.test/v1/portal/logout',{method:'POST',headers:{cookie:cookie.split(';')[0],origin:'https://example.test'}}),env,new URL('https://example.test/v1/portal/logout'),async()=>true);
 assert.equal(logout.status,200);
 const after=await portalRoute(new Request('https://example.test/v1/portal/me',{headers:{cookie:cookie.split(';')[0]}}),env,new URL('https://example.test/v1/portal/me'),async()=>true);
 assert.equal(after.status,401);
});
test('CSRF de logout com origem externa é bloqueado',async()=>{
 const response=await portalRoute(new Request('https://example.test/v1/portal/logout',{method:'POST',headers:{origin:'https://attacker.example'}}),{DB:{}},new URL('https://example.test/v1/portal/logout'),async()=>true);
 assert.equal(response.status,403);
});
