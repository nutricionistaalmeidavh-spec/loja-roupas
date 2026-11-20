// Loja Roupas — Vitrine online opcional, multi-tenant e sem dependências pagas.
import {marketplaceRoute} from './marketplace.mjs';
import {renderMarketplace} from './marketplace-page.mjs';
import {portalRoute,createOwnerCredentials,normalizeOwnerEmail} from './portal.mjs';
const HEAD={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:HEAD});
const fail=(status,error)=>json({error},status);
function normalizeSlug(input){
 const text=String(input||'').trim();
 if(text.includes('/')||text.includes('.')||text.includes('\\'))return null;
 const slug=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
 return slug.length>=3&&slug.length<=48?slug:null;
}
function normalizeStockItem(value){
 const v=value||{}, id=String(v.id||''),product_id=String(v.product_id||'');
 const name=String(v.name||'').trim(),category=String(v.category||'').trim();
 const color=String(v.color||'').trim(),size=String(v.size||'').trim();
 const photo_url=v.photo_url==null?null:String(v.photo_url).trim();
 if(!/^[a-zA-Z0-9_-]{3,96}$/.test(id)||!/^[a-zA-Z0-9_-]{2,96}$/.test(product_id)||
    name.length<1||name.length>200||category.length>100||color.length>100||size.length>32||
    !Number.isSafeInteger(v.price_cents)||v.price_cents<0||v.price_cents>9999999999||
    !Number.isSafeInteger(v.available)||v.available<0||v.available>1000000||
    !Number.isSafeInteger(v.revision)||v.revision<0||typeof v.published!=='boolean')
   throw Error('invalid_catalog_item');
 if(photo_url&&(!/^https:\/\//.test(photo_url)||photo_url.length>1000))throw Error('invalid_photo_url');
 return {id,product_id,name,category,color,size,price_cents:v.price_cents,available:v.available,revision:v.revision,published:v.published?1:0,photo_url};
}
function validateOrder(value){
 const request_id=String(value?.request_id||'').trim();
 const customer_name=String(value?.customer_name||'').trim();
 const customer_phone=String(value?.customer_phone||'').trim();
 const lines=value?.lines;
 if(!/^[A-Za-z0-9_-]{8,90}$/.test(request_id)||customer_name.length<2||customer_name.length>120||
    customer_phone.length>32||!Array.isArray(lines)||lines.length<1||lines.length>12)
   throw Error('invalid_pickup_order');
 const ids=new Set(),normalized=[];
 for(const line of lines){
  const variant_id=String(line?.variant_id||'');
  if(!/^[a-zA-Z0-9_-]{3,96}$/.test(variant_id)||!Number.isInteger(line.quantity)||
      line.quantity<1||line.quantity>10||ids.has(variant_id))throw Error('invalid_pickup_lines');
  ids.add(variant_id);
  normalized.push({variant_id,quantity:line.quantity});
 }
 return {request_id,customer_name,customer_phone,lines:normalized};
}
async function sha256(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function same(a,b){if(!a||!b||a.length<32)return false;const [x,y]=await Promise.all([sha256(a),sha256(b)]);let diff=0;for(let i=0;i<x.length;i++)diff|=x.charCodeAt(i)^y.charCodeAt(i);return diff===0;}
async function readJson(req){if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw Error('json_required');if(Number(req.headers.get('content-length')||0)>120000)throw Error('body_too_large');const raw=await req.text();if(raw.length>120000)throw Error('body_too_large');return JSON.parse(raw);}
function now(){return new Date().toISOString();}
async function activeLicense(env,installationId){
 if(!env.LICENSE_CENTER)return false;
 const id=String(installationId||'');
 if(!/^[A-Za-z0-9._:-]{8,128}$/.test(id))return false;
 const url='https://pdv-artisys.sistema-artisys.workers.dev/v1/license/status?product=LOJA_ROUPAS&installationId='+encodeURIComponent(id);
 try{const response=await env.LICENSE_CENTER.fetch(new Request(url,{method:'GET'}));
 if(!response.ok)return false;const data=await response.json();return data.active===true&&data.product==='LOJA_ROUPAS';
 }catch{return false;}
}
async function syncTenant(request,env){
 const authorization=String(request.headers.get('authorization')||'');
 if(!authorization.startsWith('Bearer ')||authorization.length>160)return null;
 const key=authorization.slice(7);if(!/^[a-f0-9]{64}$/.test(key))return null;
 const hash=await sha256(key);
 const tenant=await env.DB.prepare('SELECT id,slug,name,installation_id FROM tenants WHERE sync_hash=?').bind(hash).first();
 if(!tenant||!(await activeLicense(env,tenant.installation_id)))return null;
 return tenant;
}
async function tenantBySlug(env,slug){
 if(!slug||!env.DB)return null;
 return env.DB.prepare('SELECT id,slug,name FROM tenants WHERE slug=?').bind(slug).first();
}
function cleanReturnOrder(order){return {id:order.id,status:order.status,created_at:order.created_at,request_id:order.request_id};}
async function publicCatalog(env,slug,url){
 const tenant=await tenantBySlug(env,slug);if(!tenant)return fail(404,'store_not_found');
 const limit=40,after=String(url.searchParams.get('after')||'');
 if(after.length>96)return fail(400,'invalid_cursor');
 const results=await env.DB.prepare('SELECT id,product_id,name,category,color,size,price_cents,available,photo_url FROM variants WHERE tenant_id=? AND published=1 AND id>? ORDER BY id LIMIT ?').bind(tenant.id,after,limit+1).all();
 const list=results.results||[],page=list.slice(0,limit);
 return json({store:{slug:tenant.slug,name:tenant.name},items:page,next:list.length>limit?page[page.length-1].id:null,availability:'informativa; confirmação pela loja'});
}
async function pickup(request,env,slug){
 const tenant=await tenantBySlug(env,slug);if(!tenant)return fail(404,'store_not_found');
 const raw=await readJson(request),input=validateOrder(raw);
 const existing=await env.DB.prepare('SELECT * FROM pickup_orders WHERE tenant_id=? AND request_id=?').bind(tenant.id,input.request_id).first();
 if(existing)return json(cleanReturnOrder(existing),200);
 const limit=await env.DB.prepare("SELECT COUNT(*) AS total FROM pickup_orders WHERE tenant_id=? AND created_at>=datetime('now','-1 minute')").bind(tenant.id).first();
 if(Number(limit?.total||0)>=20)return fail(429,'many_requests');
 const qs=input.lines.map(()=>'?').join(',');
 const rows=await env.DB.prepare('SELECT id,published,available FROM variants WHERE tenant_id=? AND id IN ('+qs+')').bind(tenant.id,...input.lines.map(l=>l.variant_id)).all();
 const byId=new Map((rows.results||[]).map(row=>[row.id,row]));
 if(input.lines.some(line=>{const item=byId.get(line.variant_id);return !item||item.published!==1||Number(item.available)<line.quantity;}))
  return fail(409,'unavailable_variant');
 const id=crypto.randomUUID(),date=now();
 await env.DB.prepare("INSERT OR IGNORE INTO pickup_orders(tenant_id,id,request_id,customer_name,customer_phone,lines_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'pending',?,?)")
 .bind(tenant.id,id,input.request_id,input.customer_name,input.customer_phone,JSON.stringify(input.lines),date,date).run();
 const saved=await env.DB.prepare('SELECT * FROM pickup_orders WHERE tenant_id=? AND request_id=?').bind(tenant.id,input.request_id).first();
 return json({...cleanReturnOrder(saved),notice:'Pedido recebido. Aguarde confirmação da loja antes de se deslocar ou pagar.'},202);
}
async function adminTenants(request,env){
 const token=String(request.headers.get('authorization')||'').replace(/^Bearer /,'');
 if(!await same(token,String(env.PLATFORM_ADMIN_TOKEN||'')))return fail(401,'unauthorized');
 if(request.method==='GET'){
 const r=await env.DB.prepare('SELECT id,slug,name,created_at FROM tenants ORDER BY created_at DESC LIMIT 100').all();
 return json({tenants:r.results||[]});
 }
 if(request.method!=='POST')return fail(405,'method_not_allowed');
 const input=await readJson(request),slug=normalizeSlug(input.slug),name=String(input.name||'').trim(),
 installationId=String(input.installationId||'').trim(),ownerEmail=normalizeOwnerEmail(input.ownerEmail);
 if(!slug||name.length<2||name.length>120||!/^[A-Za-z0-9._:-]{8,128}$/.test(installationId)||!ownerEmail)return fail(400,'invalid_tenant');
 if(!await activeLicense(env,installationId))return fail(403,'license_inactive');
 if(await env.DB.prepare('SELECT id FROM tenants WHERE slug=? OR installation_id=?').bind(slug,installationId).first())return fail(409,'tenant_exists');
 const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
 const syncKey=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 const id=crypto.randomUUID(),date=now();
 const owner=await createOwnerCredentials();
 await env.DB.batch([
  env.DB.prepare('INSERT INTO tenants(id,slug,name,installation_id,sync_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
   .bind(id,slug,name,installationId,await sha256(syncKey),date,date),
  env.DB.prepare('INSERT INTO tenant_owners(tenant_id,email_normalized,password_salt,password_hash,created_at) VALUES(?,?,?,?,?)')
   .bind(id,ownerEmail,owner.salt,owner.hash,date)
 ]);
 return json({tenant:{id,slug,name},syncKey,ownerAccess:{email:ownerEmail,initialPassword:owner.initialPassword},warning:'Guarde a senha do portal e a chave de sincronização em lugares separados; ambas são exibidas somente agora. O código de ativação não é compartilhado com o portal.'},201);
}
async function syncCatalog(request,env,tenant){
 const body=await readJson(request);
 if(!Array.isArray(body.items)||body.items.length<1||body.items.length>100)return fail(400,'invalid_batch');
 const items=body.items.map(normalizeStockItem),date=now();
 if(new Set(items.map(x=>x.id)).size!==items.length)return fail(400,'duplicate_variants');
 const statements=items.map(item=>env.DB.prepare(
 'INSERT INTO variants(tenant_id,id,product_id,name,category,color,size,price_cents,available,published,revision,photo_url,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) '+
 'ON CONFLICT(tenant_id,id) DO UPDATE SET product_id=excluded.product_id,name=excluded.name,category=excluded.category,color=excluded.color,size=excluded.size,'+
 'price_cents=excluded.price_cents,available=excluded.available,published=excluded.published,revision=excluded.revision,photo_url=excluded.photo_url,updated_at=excluded.updated_at '+
 'WHERE excluded.revision>variants.revision'
 ).bind(tenant.id,item.id,item.product_id,item.name,item.category,item.color,item.size,item.price_cents,item.available,item.published,item.revision,item.photo_url,date));
 await env.DB.batch(statements);
 return json({ok:true,received:items.length});
}
async function syncOrders(env,tenant,url){
 const cursor=String(url.searchParams.get('after')||'');
 if(cursor&&!/^[0-9a-f-]{36}$/i.test(cursor))return fail(400,'invalid_cursor');
 let position=null;
 if(cursor){
  position=await env.DB.prepare('SELECT created_at,id FROM pickup_orders WHERE tenant_id=? AND id=?').bind(tenant.id,cursor).first();
  if(!position)return fail(400,'invalid_cursor');
 }
 const q="SELECT id,request_id,customer_name,customer_phone,lines_json,status,created_at FROM pickup_orders "+
  "WHERE tenant_id=? AND status IN ('pending','accepted') AND (? IS NULL OR created_at>? OR (created_at=? AND id>?)) "+
  "ORDER BY created_at ASC,id ASC LIMIT 101";
 const r=await env.DB.prepare(q).bind(tenant.id,position?.created_at??null,position?.created_at??null,position?.created_at??null,cursor||null).all();
 const rows=(r.results||[]),page=rows.slice(0,100);
 return json({orders:page.map(x=>({...x,lines:JSON.parse(x.lines_json),lines_json:undefined})),
  next:rows.length>100?page[page.length-1].id:null});
}
export function onlineOrderTransition(current,next){
 return current==='pending'&&(next==='accepted'||next==='rejected')||
        current==='accepted'&&(next==='rejected'||next==='fulfilled')||
        current===next;
}
async function syncPhoto(request,env,tenant,productId){
 if(!/^[0-9a-f-]{36}$/i.test(productId))return fail(400,'invalid_photo_id');
 if(request.method==='DELETE'){
   await env.DB.prepare('DELETE FROM public_photos WHERE tenant_id=? AND product_id=?').bind(tenant.id,productId).run();
   return json({ok:true});
 }
 if(request.method!=='PUT')return fail(405,'method_not_allowed');
 const {mime,content_base64,sha256:expectedHash}=await readJson(request);
 if(mime!=='image/webp'||typeof content_base64!=='string'||content_base64.length>100000||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(content_base64)||typeof expectedHash!=='string'||
    !/^[a-f0-9]{64}$/i.test(expectedHash))return fail(400,'invalid_photo');
 const raw=Uint8Array.from(atob(content_base64),c=>c.charCodeAt(0));
 if(raw.byteLength<24||raw.byteLength>70000)return fail(400,'invalid_photo_size');
 const magic=String.fromCharCode(...raw.subarray(0,4));
 const webp=String.fromCharCode(...raw.subarray(8,12));
 if(magic!=='RIFF'||webp!=='WEBP')return fail(400,'invalid_photo_format');
 const hash=await crypto.subtle.digest('SHA-256',raw);
 const actual=[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
 if(actual!==expectedHash)return fail(400,'invalid_photo_hash');
 await env.DB.prepare('INSERT INTO public_photos(tenant_id,product_id,content_base64,sha256,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,product_id) DO UPDATE SET content_base64=excluded.content_base64,sha256=excluded.sha256,updated_at=excluded.updated_at')
   .bind(tenant.id,productId,content_base64,actual,now()).run();
 return json({ok:true,sha256:actual});
}
async function publicPhoto(env,slug,productId){
 const tenant=await tenantBySlug(env,slug);if(!tenant||!/^[0-9a-f-]{36}$/i.test(productId))return fail(404,'photo_not_found');
 const image=await env.DB.prepare('SELECT content_base64 FROM public_photos ph WHERE ph.tenant_id=? AND ph.product_id=? AND EXISTS (SELECT 1 FROM variants v WHERE v.tenant_id=ph.tenant_id AND v.product_id=ph.product_id AND v.published=1)')
   .bind(tenant.id,productId).first();
 if(!image)return fail(404,'photo_not_found');
 return new Response(Uint8Array.from(atob(image.content_base64),c=>c.charCodeAt(0)),{headers:{'content-type':'image/webp','cache-control':'no-store','x-content-type-options':'nosniff'}});
}
async function syncOrderStatus(request,env,tenant,id){
 if(!/^[0-9a-f-]{36}$/.test(id))return fail(400,'invalid_order');
 const input=await readJson(request),status=String(input.status||'');
 if(!['accepted','rejected','fulfilled'].includes(status))return fail(400,'invalid_status');
 const date=now();
 const r=await env.DB.prepare("UPDATE pickup_orders SET status=?,updated_at=? WHERE tenant_id=? AND id=? AND ((status='pending' AND ? IN ('accepted','rejected')) OR (status='accepted' AND ? IN ('fulfilled','rejected')))")
 .bind(status,date,tenant.id,id,status,status).run();
 if(Number(r.meta?.changes||0)>0)return json({id,status});
 const current=await env.DB.prepare('SELECT status FROM pickup_orders WHERE tenant_id=? AND id=?').bind(tenant.id,id).first();
 if(!current)return fail(404,'order_not_found');
 if(current.status===status)return json({id,status,idempotent:true});
 return fail(409,'invalid_transition');
}
function uiHtml(slug){
 const title='Loja de Roupas — Vitrine';
 const css=':root{font:16px system-ui,Segoe UI,sans-serif;background:#f8f7f4;color:#272727}*{box-sizing:border-box}body{margin:0}header{padding:24px max(18px,calc((100% - 1100px)/2));border-bottom:1px solid #e7e2d8;background:white}h1{font-size:27px;margin:5px 0}small{color:#766c5d}main{max-width:1100px;margin:28px auto;padding:0 18px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}.card{border:1px solid #e1ddd4;border-radius:14px;background:white;padding:18px;display:grid;gap:10px}.card h2{font-size:18px;margin:0}.price{font-weight:750;font-size:21px}.tag{font-size:12px;color:#78716c}.btn,button{border:0;background:#252422;color:white;padding:12px 15px;border-radius:8px;cursor:pointer}button:disabled{opacity:.4;cursor:not-allowed}label{display:grid;gap:6px;margin:12px 0}input{padding:12px;border:1px solid #d5d0c6;border-radius:8px;font:inherit;width:100%}#checkout{max-width:500px;margin:30px auto;background:white;border:1px solid #e1ddd4;padding:24px;border-radius:14px}#checkout[hidden]{display:none}#feedback{padding:10px;color:#57534e}footer{margin:40px auto;text-align:center;color:#76716a;font-size:12px}';
 const script="const slug=decodeURIComponent(location.pathname.split('/')[2]||'');const cart=new Map();const fmt=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v/100);const $=id=>document.getElementById(id);const make=(tag,text)=>{let x=document.createElement(tag);x.textContent=text;return x};async function init(){let next='';do{const r=await fetch('/v1/storefront/'+encodeURIComponent(slug)+(next?'?after='+encodeURIComponent(next):''));if(!r.ok){$('feedback').textContent='Esta vitrine não está disponível.';return;}const d=await r.json();$('brand').textContent=d.store.name;document.title=d.store.name+' | ArtiSys';for(const item of d.items){const card=make('article','');card.className='card';const h=make('h2',item.name),tag=make('div',[item.color,item.size,item.category].filter(Boolean).join(' · ')),price=make('div',fmt(item.price_cents)),btn=make('button',item.available>0?'Adicionar à seleção':'Indisponível');tag.className='tag';price.className='price';btn.disabled=item.available<=0;btn.onclick=()=>{cart.set(item.id,item);$('selected').textContent='Selecionadas: '+cart.size+' peça(s).';$('checkout').hidden=false;};card.append(h,tag,price,btn);$('items').append(card);}next=d.next||'';}while(next);$('feedback').textContent='Estoque sujeito à confirmação da loja.'}async function send(event){event.preventDefault();if(cart.size===0)return;const button=$('submit');button.disabled=true;$('feedback').textContent='Enviando pedido…';try{const r=await fetch('/v1/storefront/'+encodeURIComponent(slug)+'/pickup-orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({request_id:crypto.randomUUID(),customer_name:$('name').value,customer_phone:$('phone').value,lines:[...cart.keys()].map(variant_id=>({variant_id,quantity:1}))})});const d=await r.json();if(!r.ok)throw Error(d.error||'Falha');$('feedback').textContent=d.notice||'Recebido. Aguarde confirmação da loja.';cart.clear();$('selected').textContent='Pedido enviado';$('checkout').hidden=true;}catch(e){$('feedback').textContent='Não foi possível concluir: '+e.message;}finally{button.disabled=false;}}$('form').addEventListener('submit',send);init();";
 return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><style>'+css+'</style></head><body><header><small>VITRINE AR TISYS</small><h1 id="brand">Carregando loja…</h1><p>Escolha suas peças e solicite retirada. Pedido sujeito a confirmação, sem pagamento online.</p></header><main><section id="items" class="grid" aria-label="Produtos"></section><div id="checkout" hidden><h2>Solicitar retirada</h2><p id="selected"></p><form id="form"><label>Seu nome<input id="name" required minlength="2" maxlength="120" autocomplete="name"></label><label>Telefone para contato<input id="phone" maxlength="32" autocomplete="tel"></label><button id="submit" type="submit">Enviar solicitação</button></form></div><p role="status" id="feedback"></p></main><footer>ArtiSys · Pedido só é confirmado pela loja física</footer><script>'+script+'</script></body></html>';
}
export default {async fetch(request,env){
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(method==='GET'&&path==='/health')return json({ok:true,service:'loja-roupas-vitrine',version:1});
 if(method==='GET'&&path==='/')return renderMarketplace();
 if(!env.DB)return fail(503,'storefront_not_configured');
 try{
 const market=await marketplaceRoute(request,env,url);if(market)return market;
 const portal=await portalRoute(request,env,url,activeLicense);if(portal)return portal;
 if(path==='/v1/admin/tenants')return adminTenants(request,env);
 const webpage=/^\/loja\/([a-z0-9-]{3,48})\/?$/.exec(path);
 if(method==='GET'&&webpage)return new Response(uiHtml(webpage[1]),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' https:; base-uri 'none'; form-action 'self'",'x-content-type-options':'nosniff'}});
 const publicRoute=/^\/v1\/storefront\/([a-z0-9-]{3,48})$/.exec(path);
 if(method==='GET'&&publicRoute)return publicCatalog(env,publicRoute[1],url);
 const pickupRoute=/^\/v1\/storefront\/([a-z0-9-]{3,48})\/pickup-orders$/.exec(path);
 if(method==='POST'&&pickupRoute)return pickup(request,env,pickupRoute[1]);
 const photo=/^\/v1\/media\/([a-z0-9-]{3,48})\/([a-f0-9-]{36})$/i.exec(path);
 if(method==='GET'&&photo)return publicPhoto(env,photo[1],photo[2]);
 if(path.startsWith('/v1/sync/')){
 const tenant=await syncTenant(request,env);if(!tenant)return fail(401,'invalid_license_or_sync_key');
 const uploadPhoto=/^\/v1\/sync\/photos\/([a-f0-9-]{36})$/i.exec(path);
 if(uploadPhoto&&(method==='PUT'||method==='DELETE'))return syncPhoto(request,env,tenant,uploadPhoto[1]);
 if(method==='PUT'&&path==='/v1/sync/catalog')return syncCatalog(request,env,tenant);
 if(method==='GET'&&path==='/v1/sync/orders')return syncOrders(env,tenant,url);
 const update=/^\/v1\/sync\/orders\/([0-9a-f-]{36})$/.exec(path);
 if(method==='PATCH'&&update)return syncOrderStatus(request,env,tenant,update[1]);
 return fail(404,'route_not_found');
 }
 return fail(404,'route_not_found');
 }catch(error){
 const code=String(error?.message||'');
 if(['invalid_catalog_item','invalid_photo_url','invalid_pickup_lines','invalid_pickup_order','invalid_batch','duplicate_variants','json_required','body_too_large','too_large'].includes(code)||error instanceof SyntaxError)return fail(400,code||'invalid_json');
 return fail(500,'internal_error');
 }
}};
export {normalizeSlug,normalizeStockItem,validateOrder};
