// Discovery endpoint for real, public listings only. No local database secrets.
const HEAD={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:HEAD});
function encodeCursor(row){
 return btoa(JSON.stringify([row.updated_at,row.id])).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function decodeCursor(value){
 if(!value)return null;
 if(value.length>240||!/^[A-Za-z0-9_-]+$/.test(value))throw Error('invalid_cursor');
 try{
  const data=JSON.parse(atob(value.replace(/-/g,'+').replace(/_/g,'/')));
  if(!Array.isArray(data)||data.length!==2||
   typeof data[0]!=='string'||data[0].length<10||data[0].length>40||
   typeof data[1]!=='string'||!/^[A-Za-z0-9_-]{3,96}$/.test(data[1]))throw Error('invalid');
  return data;
 }catch{throw Error('invalid_cursor');}
}
export async function marketplaceRoute(request,env,url){
 if(url.pathname!=='/v1/marketplace')return null;
 if(request.method!=='GET')return json({error:'method_not_allowed'},405);
 const q=String(url.searchParams.get('q')||'').trim().toLowerCase();
 const category=String(url.searchParams.get('category')||'').trim().toLowerCase();
 if(q.length>100||category.length>80)return json({error:'invalid_filter'},400);
 let after=null;
 try{after=decodeCursor(url.searchParams.get('after')||'');}
 catch{return json({error:'invalid_cursor'},400);}
 const filter=['v.published=1','v.available>0'],args=[];
 if(q){filter.push('(instr(lower(v.name),?)>0 OR instr(lower(v.category),?)>0 OR instr(lower(t.name),?)>0)');args.push(q,q,q);}
 if(category){filter.push('lower(v.category)=?');args.push(category);}
 if(after){filter.push('(v.updated_at < ? OR (v.updated_at = ? AND v.id > ?))');args.push(after[0],after[0],after[1]);}
 const query='SELECT v.id,v.name,v.category,v.color,v.size,v.price_cents,v.available,v.photo_url,v.updated_at,t.slug,t.name AS store_name '+
   'FROM variants v JOIN tenants t ON t.id=v.tenant_id WHERE '+filter.join(' AND ')+
   ' ORDER BY v.updated_at DESC,v.id ASC LIMIT ?';
 const products=await env.DB.prepare(query).bind(...args,37).all();
 const page=(products.results||[]).slice(0,36);
 const next_cursor=(products.results||[]).length>36?encodeCursor(page[page.length-1]):null;
 const stores=await env.DB.prepare(
  'SELECT t.slug,t.name,COUNT(v.id) AS pieces FROM tenants t INNER JOIN variants v ON v.tenant_id=t.id '+
  'WHERE v.published=1 AND v.available>0 GROUP BY t.id,t.slug,t.name ORDER BY t.updated_at DESC LIMIT 12'
 ).all();
 const categories=await env.DB.prepare(
  "SELECT v.category,COUNT(*) AS total FROM variants v WHERE v.published=1 AND v.available>0 AND LENGTH(TRIM(v.category))>0 GROUP BY v.category ORDER BY total DESC LIMIT 12"
 ).all();
 return json({items:page.map(row=>({
  id:row.id,name:row.name,category:row.category,color:row.color,size:row.size,
  price_cents:row.price_cents,available:row.available,photo_url:row.photo_url,
  store:{slug:row.slug,name:row.store_name}
 })),next_cursor,stores:(stores.results||[]).map(row=>({slug:row.slug,name:row.name,pieces:Number(row.pieces||0)})),
 categories:(categories.results||[]).map(row=>({name:row.category,total:Number(row.total||0)}))});
}
