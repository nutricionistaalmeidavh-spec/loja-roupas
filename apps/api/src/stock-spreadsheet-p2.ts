import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { requirePermission } from './auth.ts';
import { DomainError, requireIdempotencyKey, withIdempotentTransaction } from './transactions.ts';

const uuid='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
const uuidProp={type:'string',pattern:uuid};
type BulkEdit={
 variant_id:string;name:string;category:string;sku:string;color:string;size:string;
 barcode:string|null;price_cents:number;
 expected_product_revision:number;expected_variant_revision:number;
};
type MovementFilters={
 variant_id?:string;movement_kind?:string;supplier_id?:string;purchase_id?:string;
 operator_id?:string;source_type?:string;from?:string;to?:string;limit?:number;offset?:number;
};
type Existing={
 variant_id:string;product_id:string;name:string;category:string;sku:string;color:string;size:string;
 barcode:string|null;price_cents:string;product_revision:string;variant_revision:string;
};
const editable={
 type:'object',additionalProperties:false,
 required:['variant_id','name','category','sku','color','size','barcode','price_cents',
  'expected_product_revision','expected_variant_revision'],
 properties:{
  variant_id:uuidProp,
  name:{type:'string',minLength:1,maxLength:200},
  category:{type:'string',minLength:1,maxLength:100},
  sku:{type:'string',minLength:1,maxLength:64},
  color:{type:'string',minLength:1,maxLength:100},
  size:{type:'string',minLength:1,maxLength:32},
  barcode:{type:['string','null'],maxLength:128},
  price_cents:{type:'integer',minimum:0,maximum:9999999999},
  expected_product_revision:{type:'integer',minimum:1},
  expected_variant_revision:{type:'integer',minimum:1}
 }
};
const clean=(value:string)=>value.trim().replace(/\s+/g,' ');
function normalize(row:BulkEdit):BulkEdit{
 const entry={...row,name:clean(row.name),category:clean(row.category),
  color:clean(row.color),size:clean(row.size),sku:row.sku.trim().toUpperCase(),
  barcode:row.barcode?.trim()||null};
 if(!entry.name||!entry.category||!entry.color||!entry.size||
   entry.name.length>200||entry.category.length>100||entry.color.length>100||entry.size.length>32||
   !/^[A-Z0-9_-]{1,64}$/.test(entry.sku))
  throw new DomainError(422,'INVALID_BULK_ROW','Nome, categoria, SKU, cor e tamanho obrigatórios');
 return entry;
}
function numberSafe(text:string,name:string){
 const v=Number(text);if(!Number.isSafeInteger(v))throw new Error('Valor inválido: '+name);
 return v;
}

export function registerStockSpreadsheetP2(app:FastifyInstance,db:Pool){
 app.post<{Body:{items:BulkEdit[]}}>('/v1/stock/spreadsheet/bulk-edit',{
  schema:{body:{type:'object',additionalProperties:false,required:['items'],properties:{
   items:{type:'array',minItems:1,maxItems:100,items:editable}
  }}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'catalog.write'))return reply;
  const items=request.body.items.map(normalize);
  const ids=new Set(items.map(i=>i.variant_id));
  if(ids.size!==items.length)throw new DomainError(422,'DUPLICATE_VARIANT','Variante repetida no lote');
  const skus=new Set<string>(),barcodes=new Set<string>();
  for(const item of items){
   if(skus.has(item.sku))throw new DomainError(422,'DUPLICATE_SKU','SKU novo duplicado no lote');
   skus.add(item.sku);
   if(item.barcode){
    if(barcodes.has(item.barcode))throw new DomainError(422,'DUPLICATE_BARCODE','Código de barras duplicado no lote');
    barcodes.add(item.barcode);
   }
  }
  const auth=request.authContext!;
  const key=requireIdempotencyKey(request.headers['idempotency-key']);
  const normalized=items.slice().sort((a,b)=>a.variant_id.localeCompare(b.variant_id));
  const out=await withIdempotentTransaction(db,auth,'catalog.spreadsheet.bulk',key,{items:normalized},async client=>{
   const found=await client.query<Existing>(
    'SELECT v.id::text AS variant_id,p.id::text AS product_id,p.name,p.category,v.sku,v.color,v.size,v.barcode,'+
    'v.price_cents::text,p.revision::text AS product_revision,v.revision::text AS variant_revision '+
    'FROM product_variants v JOIN products p ON p.id=v.product_id AND p.store_id=v.store_id '+
    'WHERE v.store_id=$1 AND v.id=ANY($2::uuid[]) ORDER BY p.id,v.id FOR UPDATE OF p,v',
    [auth.storeId,normalized.map(i=>i.variant_id)]
   );
   if(found.rows.length!==items.length)throw new DomainError(404,'BULK_VARIANT_MISSING','Uma peça não pertence a esta loja');
   const existing=new Map(found.rows.map(v=>[v.variant_id,v]));
   const byProduct=new Map<string,{name:string;category:string;old:Existing}>();
   for(const row of normalized){
    const old=existing.get(row.variant_id);
    if(!old)throw new DomainError(404,'BULK_VARIANT_MISSING','Peça não encontrada');
    if(numberSafe(old.product_revision,'revisão produto')!==row.expected_product_revision||
     numberSafe(old.variant_revision,'revisão variante')!==row.expected_variant_revision)
     throw new DomainError(409,'REVISION_CONFLICT','Outro operador alterou algum SKU. Atualize a planilha.');
    const same=byProduct.get(old.product_id);
    if(same&&(same.name!==row.name||same.category!==row.category))
     throw new DomainError(422,'PRODUCT_FIELDS_CONFLICT','Variantes do mesmo produto têm nome ou categoria diferentes');
    byProduct.set(old.product_id,{name:row.name,category:row.category,old});
   }
   const changedProducts=new Map<string,number>();
   for(const [id,entry] of [...byProduct.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
    if(entry.name===entry.old.name&&entry.category===entry.old.category)continue;
    const newRow=await client.query<{revision:string}>(
     'UPDATE products SET name=$3,category=$4,revision=revision+1 WHERE store_id=$1 AND id=$2 RETURNING revision::text',
     [auth.storeId,id,entry.name,entry.category]);
    const version=numberSafe(newRow.rows[0].revision,'revisão');
    changedProducts.set(id,version);
    await client.query(
     "INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload) "+
     "VALUES($1,'catalog.product.updated.v1',$2,$3,$4::jsonb)",
     [auth.storeId,id,version,JSON.stringify({revision:version,bulk:true})]);
   }
   let changedVariants=0;
   try{
    for(const row of normalized){
     const old=existing.get(row.variant_id)!;
     if(row.sku===old.sku&&row.color===old.color&&row.size===old.size&&
       row.barcode===old.barcode&&row.price_cents===numberSafe(old.price_cents,'preço'))continue;
     const saved=await client.query<{revision:string}>(
      'UPDATE product_variants SET sku=$3,color=$4,size=$5,barcode=$6,price_cents=$7,revision=revision+1 '+
      'WHERE store_id=$1 AND id=$2 RETURNING revision::text',
      [auth.storeId,row.variant_id,row.sku,row.color,row.size,row.barcode,row.price_cents]);
     const rev=numberSafe(saved.rows[0].revision,'revisão');
     changedVariants++;
     await client.query(
      "INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload) "+
      "VALUES($1,'catalog.variant.updated.v1',$2,$3,$4::jsonb)",
      [auth.storeId,row.variant_id,rev,JSON.stringify({revision:rev,bulk:true})]);
    }
   }catch(error){
    if((error as {code?:string})?.code==='23505')
     throw new DomainError(409,'BULK_CONFLICT','SKU, código de barras ou variante já cadastrado');
    throw error;
   }
   await client.query(
    "INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail) "+
    "VALUES($1,$2,'catalog.spreadsheet.bulk',$3,$4::jsonb)",
    [auth.storeId,auth.userId,normalized[0].variant_id,
     JSON.stringify({variants:normalized.map(r=>r.variant_id),changed_products:changedProducts.size,
      changed_variants:changedVariants})]);
   return {updated:normalized.length,products_updated:changedProducts.size,variants_updated:changedVariants};
  });
  return {...out.result,replayed:out.replayed};
 });

 app.get<{Querystring:MovementFilters}>('/v1/stock/spreadsheet/movements',{
  schema:{querystring:{type:'object',additionalProperties:false,properties:{
   variant_id:uuidProp,movement_kind:{type:'string',enum:['receipt','sale','return','adjustment']},
   supplier_id:uuidProp,purchase_id:uuidProp,operator_id:uuidProp,source_type:{type:'string',enum:['direct_receipt','direct_receipt_reversal','purchase','spreadsheet_import','manual_receipt','sale','sale_return','manager_adjustment']},
   from:{type:'string',format:'date'},to:{type:'string',format:'date'},
   limit:{type:'integer',minimum:1,maximum:100,default:50},
   offset:{type:'integer',minimum:0,maximum:1000000,default:0}
  }}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'stock.read'))return reply;
  const f=request.query,limit=f.limit??50,offset=f.offset??0,store=request.authContext!.storeId;
  if(f.from&&f.to&&f.from>f.to)throw new DomainError(422,'DATE_RANGE','Data inicial posterior à final');
  const args=[store,f.variant_id??null,f.movement_kind??'',f.supplier_id??null,f.purchase_id??null,
   f.operator_id??null,f.from??null,f.to??null,f.source_type??''];
  const joins=
   ' FROM stock_movements m '+
   'JOIN product_variants v ON v.id=m.variant_id AND v.store_id=m.store_id '+
   'JOIN products p ON p.id=v.product_id AND p.store_id=v.store_id '+
   'JOIN stores st ON st.id=m.store_id '+
   "LEFT JOIN purchase_orders po ON m.source_type='purchase' AND po.id=m.source_id AND po.store_id=m.store_id "+
   'LEFT JOIN suppliers supplier ON supplier.id=po.supplier_id AND supplier.store_id=m.store_id '+
   "LEFT JOIN sales sale ON m.source_type='sale' AND sale.id=m.source_id AND sale.store_id=m.store_id "+
   "LEFT JOIN cash_sale_returns refunded ON m.source_type='sale_return' AND refunded.id=m.source_id AND refunded.store_id=m.store_id "+
   'LEFT JOIN LATERAL (SELECT a.actor_id FROM audit_logs a WHERE a.store_id=m.store_id AND ('+
   "(m.source_type='direct_receipt' AND a.action='inventory.direct_receipt' AND "+
   "a.aggregate_id=m.variant_id AND a.detail->>'reference_id'=m.source_id::text) OR "+
   "(m.source_type='direct_receipt_reversal' AND a.action='inventory.direct_receipt.reversal' AND "+
   "a.detail->>'original_movement_id'=m.source_id::text) OR "+
   "(m.source_type='manual_receipt' AND a.action='inventory.receipt' AND "+
   "a.aggregate_id=m.variant_id AND a.detail->>'reference_id'=m.source_id::text) OR "+
   "(m.source_type='manager_adjustment' AND a.action='inventory.adjustment' AND "+
   "a.aggregate_id=m.variant_id AND a.detail->>'reference_id'=m.source_id::text) OR "+
   "(m.source_type='purchase' AND a.action='purchase.receive' AND a.aggregate_id=m.source_id) OR "+
   "(m.source_type='spreadsheet_import' AND a.action='catalog.product.import' AND a.aggregate_id=m.source_id) "+
   ') ORDER BY a.occurred_at DESC,a.id DESC LIMIT 1) audit_actor ON true '+
   'LEFT JOIN users staff ON staff.id=coalesce(sale.cashier_id,refunded.actor_id,audit_actor.actor_id) '+
   'WHERE m.store_id=$1 '+
   'AND ($2::uuid IS NULL OR m.variant_id=$2::uuid) '+
   "AND ($3::text='' OR m.movement_kind=$3) "+
   'AND ($4::uuid IS NULL OR po.supplier_id=$4::uuid) '+
   'AND ($5::uuid IS NULL OR po.id=$5::uuid) '+
   'AND ($6::uuid IS NULL OR staff.id=$6::uuid) '+
   'AND ($7::date IS NULL OR (m.occurred_at AT TIME ZONE st.timezone)::date >= $7::date) '+
   'AND ($8::date IS NULL OR (m.occurred_at AT TIME ZONE st.timezone)::date <= $8::date) '+
   "AND ($9::text='' OR m.source_type=$9)";
  const [count,rows]=await Promise.all([
   db.query<{total:string}>('SELECT count(*)::text AS total '+joins,args),
   db.query<{
    id:string;variant_id:string;sku:string;product_name:string;movement_kind:string;
    qty_delta:string;source_type:string;source_id:string;purchase_id:string|null;
    supplier_id:string|null;supplier_name:string|null;operator_id:string|null;
    operator_login:string|null;occurred_at:Date;
   }>('SELECT m.id::text,m.variant_id::text,v.sku,p.name AS product_name,m.movement_kind,'+
    'm.qty_delta::text,m.source_type,m.source_id::text,po.id::text AS purchase_id,'+
    'supplier.id::text AS supplier_id,supplier.name AS supplier_name,'+
    'staff.id::text AS operator_id,staff.login AS operator_login,m.occurred_at '+
    joins+' ORDER BY m.occurred_at DESC,m.id DESC LIMIT $10 OFFSET $11',[...args,limit,offset])
  ]);
  return {total:numberSafe(count.rows[0]?.total??'0','total'),limit,offset,
   items:rows.rows.map(r=>({...r,qty_delta:numberSafe(r.qty_delta,'quantidade'),
    occurred_at:r.occurred_at.toISOString()}))};
 });

 app.get('/v1/stock/spreadsheet/filter-options',async(request,reply)=>{
  if(requirePermission(request,reply,'stock.read'))return reply;
  const store=request.authContext!.storeId;
  const [suppliers,operators,orders]=await Promise.all([
   db.query<{id:string;name:string}>('SELECT id::text,name FROM suppliers WHERE store_id=$1 ORDER BY name,id LIMIT 500',[store]),
   db.query<{id:string;login:string}>(
    'SELECT DISTINCT u.id::text,u.login FROM users u JOIN user_store_roles r ON r.user_id=u.id '+
    'WHERE r.store_id=$1 ORDER BY u.login,u.id::text LIMIT 500',[store]),
   db.query<{id:string;sku:string;supplier_name:string}>(
    'SELECT po.id::text,v.sku,s.name AS supplier_name FROM purchase_orders po '+
    'JOIN product_variants v ON v.id=po.variant_id AND v.store_id=po.store_id '+
    'JOIN suppliers s ON s.id=po.supplier_id AND s.store_id=po.store_id '+
    'WHERE po.store_id=$1 ORDER BY po.created_at DESC,po.id DESC LIMIT 500',[store])
  ]);
  return {suppliers:suppliers.rows,operators:operators.rows,purchases:orders.rows};
 });
}
