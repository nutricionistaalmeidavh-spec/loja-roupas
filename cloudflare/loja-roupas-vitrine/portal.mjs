// Portal web opcional do lojista. Nunca armazena token de sincronização no navegador.
const COOKIE='__Host-lojaroupas_portal_session';
const SESSION_MS=8*60*60*1000, LOCK_MS=15*60*1000, MAX_ATTEMPTS=8;
const HEAD={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{...HEAD,...headers}});
const error=(status,code)=>json({error:code},status);
const encoder=new TextEncoder();
function hex(bytes){return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');}
function bytes(text){return Uint8Array.from(text.match(/.{2}/g)||[],x=>Number.parseInt(x,16));}
function randomHex(size){const result=new Uint8Array(size);crypto.getRandomValues(result);return hex(result);}
async function digest(value){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))));}
export function normalizeOwnerEmail(raw){
 const email=String(raw||'').trim().toLowerCase();
 return email.length<=254&&/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(email)?email:null;
}
async function passwordHash(password,salt){
 const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
 return hex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:bytes(salt),iterations:210000},key,256)));
}
export async function verifyOwnerPassword(password,salt,hash){
 if(typeof password!=='string'||password.length>256||!(/^[a-f0-9]{32}$/.test(salt)||/^[a-f0-9]{64}$/.test(hash)))return false;
 const expected=await passwordHash(password,salt);
 let mismatch=0;for(let i=0;i<expected.length;i++)mismatch|=expected.charCodeAt(i)^hash.charCodeAt(i);
 return mismatch===0;
}
export async function createOwnerCredentials(){
 const initialPassword=randomHex(24),salt=randomHex(16);
 return {initialPassword,salt,hash:await passwordHash(initialPassword,salt)};
}
function cookieValue(request){
 const cookies=String(request.headers.get('cookie')||'').split(';');
 for(const raw of cookies){const eq=raw.indexOf('=');if(eq<0)continue;
 if(raw.slice(0,eq).trim()===COOKIE)return raw.slice(eq+1).trim();}
 return '';
}
const cookie=(value,seconds)=>COOKIE+'='+value+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+seconds;
async function parseJson(request){
 if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw Error('json_required');
 if(Number(request.headers.get('content-length')||0)>4096)throw Error('too_large');
 const raw=await request.text();if(raw.length>4096)throw Error('too_large');
 return JSON.parse(raw);
}
function sameOrigin(request,url){
 const origin=request.headers.get('origin');
 return !origin||origin===url.origin;
}
async function sessionFor(request,env,verifyLicense){
 const token=cookieValue(request);
 if(!/^[a-f0-9]{64}$/.test(token))return null;
 const row=await env.DB.prepare(
  'SELECT s.tenant_id,t.slug,t.name,t.installation_id,o.email_normalized AS owner_email,s.expires_at '+
  'FROM tenant_sessions s JOIN tenants t ON t.id=s.tenant_id JOIN tenant_owners o ON o.tenant_id=t.id '+
  'WHERE s.digest=? AND s.expires_at>? LIMIT 1'
 ).bind(await digest(token),new Date().toISOString()).first();
 if(!row)return null;
 return await verifyLicense(env,row.installation_id)?row:null;
}
export async function portalRoute(request,env,url,verifyLicense){
 if(!url.pathname.startsWith('/v1/portal/'))return null;
 const method=request.method,pathname=url.pathname;
 if(method!=='GET'&&!sameOrigin(request,url))return error(403,'invalid_origin');
 if(pathname==='/v1/portal/login'&&method==='POST'){
  const input=await parseJson(request);
  const slug=String(input?.slug||'').trim().toLowerCase(),email=normalizeOwnerEmail(input?.email),password=input?.password;
  if(!/^[a-z0-9][a-z0-9-]{2,47}$/.test(slug)||!email||typeof password!=='string'||
    password.length<8||password.length>256)return error(400,'invalid_login_input');
  const attemptKey=await digest('loja-portal:'+slug+':'+email);
  const attempt=await env.DB.prepare('SELECT attempts,last_at FROM portal_login_attempts WHERE digest=?').bind(attemptKey).first();
  const timestamp=Date.now(),stale=!attempt||timestamp-Date.parse(attempt.last_at)>LOCK_MS;
  if(!stale&&Number(attempt.attempts)>=MAX_ATTEMPTS)return error(429,'too_many_attempts');
  const account=await env.DB.prepare(
   'SELECT t.id,t.slug,t.name,t.installation_id,o.email_normalized,o.password_salt,o.password_hash '+
   'FROM tenants t JOIN tenant_owners o ON o.tenant_id=t.id '+
   'WHERE t.slug=? AND o.email_normalized=? LIMIT 1'
  ).bind(slug,email).first();
  const accepted=account?await verifyOwnerPassword(password,account.password_salt,account.password_hash):false;
  if(!accepted){
   const now=new Date().toISOString(),reset=new Date(timestamp-LOCK_MS).toISOString();
   await env.DB.prepare(
    'INSERT INTO portal_login_attempts(digest,attempts,last_at) VALUES(?,1,?) '+
    'ON CONFLICT(digest) DO UPDATE SET attempts=CASE WHEN portal_login_attempts.last_at<? THEN 1 ELSE portal_login_attempts.attempts+1 END,last_at=excluded.last_at'
   ).bind(attemptKey,now,reset).run();
   return error(401,'invalid_credentials');
  }
  if(!(await verifyLicense(env,account.installation_id)))return error(403,'license_inactive');
  await env.DB.prepare('DELETE FROM portal_login_attempts WHERE digest=?').bind(attemptKey).run();
  const rawToken=randomHex(32),now=new Date().toISOString(),expiresAt=new Date(timestamp+SESSION_MS).toISOString();
  await env.DB.prepare('INSERT INTO tenant_sessions(digest,tenant_id,issued_at,expires_at) VALUES(?,?,?,?)')
   .bind(await digest(rawToken),account.id,now,expiresAt).run();
  return json({ok:true,tenant:{slug:account.slug,name:account.name}},200,{
   'set-cookie':cookie(rawToken,Math.floor(SESSION_MS/1000))
  });
 }
 if(pathname==='/v1/portal/logout'&&method==='POST'){
  const token=cookieValue(request);
  if(/^[a-f0-9]{64}$/.test(token))await env.DB.prepare('DELETE FROM tenant_sessions WHERE digest=?').bind(await digest(token)).run();
  return json({ok:true},200,{'set-cookie':cookie('',0)});
 }
 if(pathname==='/v1/portal/me'&&method==='GET'){
  const current=await sessionFor(request,env,verifyLicense);
  if(!current)return error(401,'login_required');
  const [variants,orders]=await Promise.all([
   env.DB.prepare('SELECT COUNT(*) AS total FROM variants WHERE tenant_id=? AND published=1').bind(current.tenant_id).first(),
   env.DB.prepare("SELECT COUNT(*) AS total FROM pickup_orders WHERE tenant_id=? AND status='pending'").bind(current.tenant_id).first()
  ]);
  return json({tenant:{slug:current.slug,name:current.name},ownerEmail:current.owner_email,
   summary:{published:Number(variants?.total||0),pending:Number(orders?.total||0)}});
 }
 if(pathname==='/v1/portal/orders'&&method==='GET'){
  const current=await sessionFor(request,env,verifyLicense);
  if(!current)return error(401,'login_required');
  const data=await env.DB.prepare('SELECT id,request_id,customer_name,customer_phone,lines_json,status,created_at FROM pickup_orders WHERE tenant_id=? ORDER BY created_at DESC LIMIT 60')
   .bind(current.tenant_id).all();
  return json({orders:(data.results||[]).map(x=>({id:x.id,requestId:x.request_id,customerName:x.customer_name,
   customerPhone:x.customer_phone,lines:JSON.parse(x.lines_json),status:x.status,createdAt:x.created_at}))});
 }
 return error(404,'route_not_found');
}
