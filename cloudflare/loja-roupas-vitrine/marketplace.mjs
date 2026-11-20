// Discovery endpoint for real, public listings only. No local database secrets.
const HEAD={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:HEAD});
export async function marketplaceRoute(request,env,url){
 if(url.pathname!=='/v1/marketplace')return null;
 if(request.method!=='GET')return json({error:'method_not_allowed'},405);
 const q=String(url.searchParams.get('q')||'').trim().toLowerCase();
 const category=String(url.searchParams.get('category')||'').trim().toLowerCase();
 if(q.length>100||category.length>80)return json({error:'invalid_filter'},400);
 const filter=['v.published=1','v.available>0'],args=[];
 if(q){filter.push('(instr(lower(v.name),?)>0 OR instr(lower(v.category),?)>0 OR instr(lower(t.name),?)>0)');args.push(q,q,q);}
 if(category){filter.push('lower(v.category)=?');args.push(category);}
 const query='SELECT v.id,v.name,v.category,v.color,v.size,v.price_cents,v.available,v.photo_url,t.slug,t.name AS store_name '+
   'FROM variants v JOIN tenants t ON t.id=v.tenant_id WHERE '+filter.join(' AND ')+
   ' ORDER BY v.updated_at DESC,v.id ASC LIMIT ?';
 const products=await env.DB.prepare(query).bind(...args,36).all();
 const stores=await env.DB.prepare(
  'SELECT t.slug,t.name,COUNT(v.id) AS pieces FROM tenants t INNER JOIN variants v ON v.tenant_id=t.id '+
  'WHERE v.published=1 AND v.available>0 GROUP BY t.id,t.slug,t.name ORDER BY t.updated_at DESC LIMIT 12'
 ).all();
 const categories=await env.DB.prepare(
  "SELECT v.category,COUNT(*) AS total FROM variants v WHERE v.published=1 AND v.available>0 AND LENGTH(TRIM(v.category))>0 GROUP BY v.category ORDER BY total DESC LIMIT 12"
 ).all();
 return json({items:(products.results||[]).map(row=>({
  id:row.id,name:row.name,category:row.category,color:row.color,size:row.size,
  price_cents:row.price_cents,available:row.available,photo_url:row.photo_url,
  store:{slug:row.slug,name:row.store_name}
 })),stores:(stores.results||[]).map(row=>({slug:row.slug,name:row.name,pieces:Number(row.pieces||0)})),
 categories:(categories.results||[]).map(row=>({name:row.category,total:Number(row.total||0)}))});
}
