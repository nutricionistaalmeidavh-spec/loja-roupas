// Online opcional da Loja Roupas. Um Worker para N vitrines; dados do PDV ficam locais.
const CENTRAL='https://pdv-artisys.sistema-artisys.workers.dev';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const slugPattern=/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;
const clean=x=>String(x??'').trim();
const now=()=>new Date().toISOString();
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
 'content-type':'application/json; charset=utf-8','cache-control':'no-store',
 'access-control-allow-origin':'*','x-content-type-options':'nosniff'
}});
const fail=(message,status=400)=>json({error:message},status);
const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const text=(x,max)=>typeof x==='string'&&x.trim().length>0&&x.trim().length<=max;
const slugOf=x=>clean(x).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,'-');
export function normalizeSlug(input){
 if(typeof input!=='string'||input.length>100)return null;
 const value=slugOf(input);
 return slugPattern.test(value)&&!value.includes('--')?value:null;
}
export function validateBatch(input){
 if(!input||!Array.isArray(input.items)||input.items.length<1||input.items.length>50)throw Error('Envie de 1 a 50 variantes.');
 const ids=new Set();
 return input.items.map(v=>{
  if(!UUID.test(v?.id)||ids.has(v.id))throw Error('Variante duplicada ou inválida.');
  ids.add(v.id);
  if(!text(v.name,160)||!text(v.sku,90)||!text(v.color,60)||!text(v.size,40)||!text(v.category,90)||
   !integer(v.priceCents,0,100000000)||!integer(v.available,0,1000000)||
   !integer(v.revision,0,2147483647)||typeof v.published!=='boolean')
    throw Error('Campos de variante inválidos.');
  return {id:v.id.toLowerCase(),name:clean(v.name),sku:clean(v.sku),color:clean(v.color),
   size:clean(v.size),category:clean(v.category),priceCents:v.priceCents,
   available:v.available,published:v.published,revision:v.revision};
 });
}
export function validateOrder(input){
 if(!input||!UUID.test(input.requestId)||!Array.isArray(input.lines)||
   input.lines.length<1||input.lines.length>10)throw Error('Pedido inválido.');
 const seen=new Set();
 const lines=input.lines.map(line=>{
  if(!UUID.test(line?.variantId)||seen.has(line.variantId)||!integer(line.quantity,1,10))
   throw Error('Variante ou quantidade inválida.');
  seen.add(line.variantId);
  return {variantId:line.variantId.toLowerCase(),quantity:line.quantity};
 });
 lines.sort((a,b)=>a.variantId.localeCompare(b.variantId));
 return {requestId:input.requestId.toLowerCase(),lines};
}
async function body(request){
 if(Number(request.headers.get('content-length')||0)>65536)throw Error('Corpo muito grande.');
 const raw=await request.text();
 if(raw.length>65536)throw Error('Corpo muito grande.');
 return JSON.parse(raw);
}
async function digest(raw){
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)));
 return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
}
function syncToken(){
 const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
 return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
}
async function tenantBySlug(db,slug){
 return db.prepare('SELECT id,slug,display_name,last_sync_at,enabled FROM tenants WHERE slug=? AND enabled=1')
  .bind(slug).first();
}
async function tenantForSync(request,env,tenantId){
 const auth=String(request.headers.get('authorization')||'');
 if(!/^Bearer [a-f0-9]{64}$/i.test(auth)||!UUID.test(String(tenantId||'')))return null;
 const tenant=await env.DB.prepare('SELECT id,slug,installation_id,sync_secret_hash,enabled FROM tenants WHERE id=? AND enabled=1')
  .bind(tenantId).first();
 if(!tenant||!tenant.enabled)return null;
 const hash=await digest(auth.slice(7));
 return hash===tenant.sync_secret_hash?tenant:null;
}
async function licenseActive(installationId){
 try{
  const url=CENTRAL+'/v1/license/status?installationId='+encodeURIComponent(installationId)+'&product=LOJA_ROUPAS';
  const response=await fetch(url,{signal:AbortSignal.timeout(6000),redirect:'manual'});
  if(!response.ok)return false;
  const result=await response.json();
  return result.active===true&&result.product==='LOJA_ROUPAS';
 }catch{return false;}
}
async function enroll(request,env){
 let input;
 try{input=await body(request);}catch{return fail('JSON inválido');}
 const slug=normalizeSlug(input?.slug);
 if(!slug||!UUID.test(input?.storeId)||!text(input?.name,100)||
   typeof input?.proof!=='string'||!/^[A-Za-z0-9_-]{40,80}$/.test(input.proof))
  return fail('Informe loja, nome, endereço e comprovante de ativação válidos.');
 const current=await env.DB.prepare('SELECT license_id FROM tenants WHERE slug=?').bind(slug).first();
 if(current)return fail('Endereço da vitrine já reservado. Use outro.',409);
 let result;
 try{
  const response=await fetch(CENTRAL+'/v1/loja-roupas/enrollment/consume',{
   method:'POST',redirect:'manual',headers:{'content-type':'application/json'},
   body:JSON.stringify({proof:input.proof}),signal:AbortSignal.timeout(7000)
  });
  if(!response.ok)return fail('Comprovante de licença inválido, expirado ou utilizado.',403);
  result=await response.json();
 }catch{return fail('Central de licenças indisponível. A loja local continua funcionando.',503);}
 if(result.product!=='LOJA_ROUPAS'||!/^license-[a-zA-Z0-9-]{4,90}$/.test(String(result.licenseId||''))||
    !/^[A-Za-z0-9._:-]{8,128}$/.test(String(result.installationId||'')))return fail('Resposta de licença inválida.',502);
 const token=syncToken(),tenantId=crypto.randomUUID(),hash=await digest(token),stamp=now();
 try{
  const existing=await env.DB.prepare('SELECT id,slug FROM tenants WHERE license_id=?').bind(result.licenseId).first();
  if(existing){
   await env.DB.prepare('UPDATE tenants SET installation_id=?,local_store_id=?,sync_secret_hash=?,enabled=1 WHERE id=?')
    .bind(result.installationId,input.storeId,hash,existing.id).run();
   return json({tenantId:existing.id,slug:existing.slug,syncToken:token,rotated:true},200);
  }
  await env.DB.prepare('INSERT INTO tenants(id,license_id,local_store_id,installation_id,slug,display_name,sync_secret_hash,created_at) VALUES(?,?,?,?,?,?,?,?)')
   .bind(tenantId,result.licenseId,input.storeId,result.installationId,slug,clean(input.name),hash,stamp).run();
  return json({tenantId,slug,syncToken:token,rotated:false},201);
 }catch{return fail('Não foi possível cadastrar a vitrine. Verifique se o nome está disponível.',409);}
}
async function syncCatalog(request,env){
 let input;
 try{input=await body(request);}catch{return fail('JSON inválido');}
 const tenant=await tenantForSync(request,env,input?.tenantId);
 if(!tenant)return fail('Credencial de loja inválida.',401);
 if(!await licenseActive(tenant.installation_id))return fail('Licença indisponível; sincronização suspensa.',403);
 let items;
 try{items=validateBatch(input);}catch(error){return fail(error.message);}
 const stamp=now();
 const statements=items.map(v=>env.DB.prepare(
  'INSERT INTO catalog_variants(tenant_id,variant_id,product_name,sku,color,size,category,price_cents,available,published,revision,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) '+
  'ON CONFLICT(tenant_id,variant_id) DO UPDATE SET product_name=excluded.product_name,sku=excluded.sku,color=excluded.color,size=excluded.size,category=excluded.category,price_cents=excluded.price_cents,available=excluded.available,published=excluded.published,revision=excluded.revision,updated_at=excluded.updated_at WHERE excluded.revision>catalog_variants.revision'
 ).bind(tenant.id,v.id,v.name,v.sku,v.color,v.size,v.category,v.priceCents,v.available,
  v.published?1:0,v.revision,stamp));
 statements.push(env.DB.prepare('UPDATE tenants SET last_sync_at=? WHERE id=?').bind(stamp,tenant.id));
 await env.DB.batch(statements);
 return json({accepted:items.length,at:stamp});
}
async function publicCatalog(request,env,slug){
 const tenant=await tenantBySlug(env.DB,slug);
 if(!tenant)return fail('Loja não encontrada.',404);
 const url=new URL(request.url),limit=Math.min(50,Math.max(1,Number(url.searchParams.get('limit'))||24));
 const after=url.searchParams.get('after')||'';
 if(after&& !UUID.test(after))return fail('Cursor inválido.');
 const result=await env.DB.prepare('SELECT variant_id AS id,product_name AS name,sku,color,size,category,price_cents AS priceCents,available FROM catalog_variants WHERE tenant_id=? AND published=1 AND variant_id>? ORDER BY variant_id LIMIT ?')
  .bind(tenant.id,after,limit+1).all();
 const rows=result.results||[];
 return json({store:{slug:tenant.slug,name:tenant.display_name,lastSyncAt:tenant.last_sync_at},
  items:rows.slice(0,limit),nextCursor:rows.length>limit?rows[limit-1].id:null,
  stockNotice:'Pedido sujeito à confirmação pela loja. Estoque online pode estar desatualizado.'});
}
async function createOrder(request,env,slug){
 const tenant=await tenantBySlug(env.DB,slug);
 if(!tenant)return fail('Loja não encontrada.',404);
 let input;
 try{input=validateOrder(await body(request));}catch(error){return fail(error.message);}
 const canonical=JSON.stringify(input.lines);
 const existing=await env.DB.prepare('SELECT id,status,lines_json,quote_cents FROM pickup_orders WHERE tenant_id=? AND request_key=?')
  .bind(tenant.id,input.requestId).first();
 if(existing){
  if(existing.lines_json!==canonical)return fail('Esta solicitação já foi utilizada com outros itens.',409);
  return json({id:existing.id,status:existing.status,quoteCents:existing.quote_cents});
 }
 const ids=input.lines.map(x=>x.variantId),marks=ids.map(()=>'?').join(',');
 const found=await env.DB.prepare('SELECT variant_id,price_cents,available FROM catalog_variants WHERE tenant_id=? AND published=1 AND variant_id IN ('+marks+')')
  .bind(tenant.id,...ids).all();
 if((found.results||[]).length!==ids.length)return fail('Produto retirado da vitrine. Atualize o catálogo.',409);
 const prices=new Map(found.results.map(x=>[x.variant_id,x]));
 let total=0;
 for(const line of input.lines){
  const value=prices.get(line.variantId);
  if(!value||value.available<line.quantity)return fail('Estoque estimado insuficiente. Atualize a vitrine.',409);
  total+=value.price_cents*line.quantity;
  if(!Number.isSafeInteger(total)||total>100000000)return fail('Pedido excede limite permitido.');
 }
 const quota=await env.DB.prepare("SELECT COUNT(*) AS n FROM pickup_orders WHERE tenant_id=? AND created_at>?")
  .bind(tenant.id,new Date(Date.now()-60000).toISOString()).first();
 if(Number(quota?.n||0)>=20)return fail('Limite de pedidos temporário. Tente novamente.',429);
 const id=crypto.randomUUID(),stamp=now();
 try{
  await env.DB.prepare("INSERT INTO pickup_orders(id,tenant_id,request_key,status,lines_json,quote_cents,created_at,updated_at) VALUES(?,?,?,'pending',?,?,?,?)")
   .bind(id,tenant.id,input.requestId,canonical,total,stamp,stamp).run();
  return json({id,status:'pending',quoteCents:total,
   notice:'Solicitação recebida; aguardando confirmação de disponibilidade da loja. Nenhum pagamento foi realizado.'},201);
 }catch{
  const row=await env.DB.prepare('SELECT id,status,lines_json,quote_cents FROM pickup_orders WHERE tenant_id=? AND request_key=?')
   .bind(tenant.id,input.requestId).first();
  if(!row||row.lines_json!==canonical)return fail('Solicitação conflitante.',409);
  return json({id:row.id,status:row.status,quoteCents:row.quote_cents});
 }
}
async function orderStatus(env,slug,id){
 if(!UUID.test(id))return fail('Pedido inválido.',400);
 const tenant=await tenantBySlug(env.DB,slug);
 if(!tenant)return fail('Loja não encontrada.',404);
 const row=await env.DB.prepare('SELECT id,status,quote_cents FROM pickup_orders WHERE tenant_id=? AND id=?')
  .bind(tenant.id,id).first();
 return row?json({id:row.id,status:row.status,quoteCents:row.quote_cents}):fail('Pedido não encontrado.',404);
}
async function syncOrders(request,env){
 const url=new URL(request.url),tenantId=url.searchParams.get('tenantId');
 const tenant=await tenantForSync(request,env,tenantId);
 if(!tenant)return fail('Credencial de loja inválida.',401);
 if(!await licenseActive(tenant.installation_id))return fail('Licença indisponível.',403);
 const after=url.searchParams.get('after')||'';
 if(after&&(!UUID.test(after)))return fail('Cursor inválido.');
 let query='SELECT id,status,lines_json,quote_cents,created_at FROM pickup_orders WHERE tenant_id=? AND status=?';
 let args=[tenant.id,'pending'];
 if(after){
  const row=await env.DB.prepare('SELECT created_at FROM pickup_orders WHERE tenant_id=? AND id=?').bind(tenant.id,after).first();
  if(!row)return fail('Cursor não encontrado.',400);
  query+=' AND (created_at>? OR (created_at=? AND id>?))';
  args.push(row.created_at,row.created_at,after);
 }
 query+=' ORDER BY created_at,id LIMIT 51';
 const result=await env.DB.prepare(query).bind(...args).all();
 const rows=result.results||[];
 return json({items:rows.slice(0,50).map(x=>({id:x.id,status:x.status,lines:JSON.parse(x.lines_json),quoteCents:x.quote_cents,createdAt:x.created_at})),
  nextCursor:rows.length>50?rows[49].id:null});
}
async function acknowledgeOrder(request,env,id){
 if(!UUID.test(id))return fail('Pedido inválido.');
 let input;
 try{input=await body(request);}catch{return fail('JSON inválido');}
 const tenant=await tenantForSync(request,env,input?.tenantId);
 if(!tenant)return fail('Credencial de loja inválida.',401);
 if(!await licenseActive(tenant.installation_id))return fail('Licença indisponível.',403);
 const status=input?.status;
 if(!['accepted','rejected','fulfilled'].includes(status))return fail('Status inválido.');
 const row=await env.DB.prepare('SELECT status FROM pickup_orders WHERE tenant_id=? AND id=?').bind(tenant.id,id).first();
 if(!row)return fail('Pedido inexistente.',404);
 if(row.status===status)return json({id,status});
 if(row.status!=='pending' || status==='fulfilled')return fail('Transição inválida.',409);
 const changed=await env.DB.prepare("UPDATE pickup_orders SET status=?,updated_at=? WHERE tenant_id=? AND id=? AND status='pending'")
  .bind(status,now(),tenant.id,id).run();
 return Number(changed.meta?.changes||0)===1?json({id,status}):fail('Pedido já atualizado.',409);
}
const PAGE=[
'<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
'<title>Loja Roupas · Vitrine</title><style>',
'*{box-sizing:border-box}body{margin:0;background:#f7f5f0;color:#25231f;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}button{cursor:pointer;font:inherit}header{background:#fff;border-bottom:1px solid #e9e6df;padding:20px max(22px,calc((100vw - 1180px)/2))}header strong{letter-spacing:.09em;font-size:15px}header small{display:block;color:#7b7468}main{max-width:1180px;margin:0 auto;padding:clamp(24px,4vw,55px) 20px;display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:30px}h1{font-size:clamp(28px,4vw,43px);margin:0 0 4px;letter-spacing:-.05em}h2{font-size:19px;margin:0 0 14px}p{color:#676157}#grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(195px,1fr));gap:14px;margin-top:24px}.item{background:#fff;border:1px solid #e7e4dd;border-radius:15px;overflow:hidden}.visual{height:155px;background:#eae7df;display:grid;place-items:center;color:#9a9182;font-size:32px}.item-inner{padding:15px}.item h3{font-size:15px;margin:0 0 6px}.item small{color:#726c63;display:block}.item .price{font-weight:750;font-size:17px;margin:8px 0}.item button,.cart button{background:#26241f;color:white;border:0;border-radius:9px;padding:10px 13px}.item button:disabled{background:#ddd;color:#777}.cart{align-self:start;position:sticky;top:25px;padding:24px;background:#fff;border:1px solid #e7e4dd;border-radius:16px}.cart ul{padding:0;list-style:none;display:grid;gap:12px}.cart li{border-bottom:1px solid #eee;padding-bottom:9px}.cart button{width:100%;margin-top:10px}.cart button:disabled{opacity:.45;cursor:default}.notice{font-size:12px;color:#8b7960}.status{background:#f1eee6;border-radius:9px;padding:12px;overflow-wrap:anywhere}.muted{color:#776e62}@media(max-width:800px){main{display:flex;flex-direction:column}.cart{position:static;width:100%}#grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:390px){#grid{grid-template-columns:1fr}}',
'</style></head><body><header><strong>LOJA ROUPAS</strong><small>Vitrine digital · Solicitações para retirada</small></header>',
'<main><section><small class="muted">COLEÇÃO DA LOJA</small><h1 id="store-name">Catálogo da loja</h1>',
'<p>Escolha suas peças e solicite a retirada. A disponibilidade será confirmada pela loja.</p><div id="status" role="status"></div>',
'<div id="grid" aria-label="Produtos disponíveis"></div><button id="more" hidden type="button">Ver mais produtos</button></section>',
'<aside class="cart" aria-label="Seu pedido"><h2>Seu pedido</h2><ul id="cart"></ul><p id="total">R$ 0,00</p>',
'<button id="send" disabled type="button">Solicitar retirada</button><p class="notice">Nenhum pagamento é feito nesta página. A loja confirma disponibilidade, valor e retirada.</p>',
'<div id="result" role="status"></div></aside></main><script>',
'const slug=decodeURIComponent(location.pathname.split("/").filter(Boolean).at(-1));',
'const cart=new Map(),items=new Map();let cursor=null;',
'const money=c=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(c/100);',
'const e=(tag,cl,text)=>{const n=document.createElement(tag);if(cl)n.className=cl;if(text!==undefined)n.textContent=text;return n};',
'function paint(){const list=document.getElementById("cart");list.replaceChildren();let total=0;',
'for(const [id,q] of cart){const p=items.get(id);if(!p)continue;total+=Number(p.priceCents)*q;',
'const li=e("li",null,p.name+" · "+p.color+"/"+p.size+" · "+q+" × "+money(Number(p.priceCents)));',
'const rm=e("button",null,"Remover");rm.type="button";rm.onclick=()=>{cart.delete(id);paint()};li.append(rm);list.append(li)}',
'document.getElementById("total").textContent="Estimativa: "+money(total);document.getElementById("send").disabled=!cart.size}',
'async function load(){const u="/v1/stores/"+encodeURIComponent(slug)+"/catalog"+(cursor?"?after="+encodeURIComponent(cursor):"");',
'const res=await fetch(u);if(!res.ok)throw Error("Não foi possível carregar a loja.");const data=await res.json();',
'document.getElementById("store-name").textContent=data.store.name;',
'for(const p of data.items){items.set(p.id,p);const card=e("article","item");const photo=e("div","visual","◇");',
'const inner=e("div","item-inner");inner.append(e("h3",null,p.name),e("small",null,p.category+" · "+p.color+" · "+p.size+" · SKU "+p.sku),e("div","price",money(Number(p.priceCents))));',
'const btn=e("button",null,Number(p.available)>0?"Adicionar":"Indisponível");btn.disabled=Number(p.available)<1;',
'btn.onclick=()=>{cart.set(p.id,Math.min(Number(p.available),10,(cart.get(p.id)||0)+1));paint()};inner.append(btn);card.append(photo,inner);document.getElementById("grid").append(card)}',
'cursor=data.nextCursor;document.getElementById("more").hidden=!cursor;document.getElementById("status").textContent=data.items.length?"":"Nenhum produto publicado nesta loja."}',
'document.getElementById("more").onclick=()=>load().catch(err=>document.getElementById("status").textContent=err.message);',
'document.getElementById("send").onclick=async()=>{const btn=document.getElementById("send");btn.disabled=true;',
'try{const requestId=crypto.randomUUID();const lines=[...cart].map(([variantId,quantity])=>({variantId,quantity}));',
'const response=await fetch("/v1/stores/"+encodeURIComponent(slug)+"/pickup-orders",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({requestId,lines})});',
'const data=await response.json();if(!response.ok)throw Error(data.error||"Solicitação não enviada");',
'const result=document.getElementById("result");result.replaceChildren(e("p","status","Solicitação recebida. Aguardando confirmação da loja. Código: "+data.id));cart.clear();paint()}',
'catch(err){document.getElementById("result").textContent=err.message}finally{btn.disabled=!cart.size}};',
'load().catch(err=>document.getElementById("status").textContent=err.message);',
'</script></body></html>'
].join('');
function shopPage(){
 return new Response(PAGE,{headers:{
  'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',
  'content-security-policy':"default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
 }});
}
async function fetchHandler(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{
  'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS',
  'access-control-allow-headers':'authorization,content-type','access-control-max-age':'3600'
 }});
 if(request.method==='GET'&&path==='/health')return json({ok:true,service:'loja-roupas-vitrine',multiTenant:true,offlineCore:true});
 if(!env?.DB)return fail('Banco da vitrine não configurado.',503);
 if(request.method==='POST'&&path==='/v1/sync/enroll')return enroll(request,env);
 if(request.method==='POST'&&path==='/v1/sync/catalog')return syncCatalog(request,env);
 if(request.method==='GET'&&path==='/v1/sync/orders')return syncOrders(request,env);
 const syncStatus=/^\/v1\/sync\/orders\/([0-9a-f-]{36})\/ack$/i.exec(path);
 if(request.method==='POST'&&syncStatus)return acknowledgeOrder(request,env,syncStatus[1]);
 const catalog=/^\/v1\/stores\/([a-z0-9-]+)\/catalog$/.exec(path);
 if(request.method==='GET'&&catalog)return publicCatalog(request,env,catalog[1]);
 const orders=/^\/v1\/stores\/([a-z0-9-]+)\/pickup-orders$/.exec(path);
 if(request.method==='POST'&&orders)return createOrder(request,env,orders[1]);
 const track=/^\/v1\/stores\/([a-z0-9-]+)\/orders\/([0-9a-f-]{36})$/i.exec(path);
 if(request.method==='GET'&&track)return orderStatus(env,track[1],track[2]);
 const shop=/^\/loja\/([a-z0-9-]+)\/?$/.exec(path);
 if(request.method==='GET'&&shop){
  const tenant=await tenantBySlug(env.DB,shop[1]);
  return tenant?shopPage():fail('Loja não encontrada.',404);
 }
 return fail('Rota não encontrada.',404);
}
export default {async fetch(request,env){
 try{return await fetchHandler(request,env);}
 catch(error){console.error(JSON.stringify({event:'loja_vitrine_error',kind:error?.name||'Error'}));return fail('Serviço temporariamente indisponível.',503);}
}};
