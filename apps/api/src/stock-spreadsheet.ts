import type {FastifyInstance} from 'fastify';
import type {Pool} from 'pg';
import {requirePermission} from './auth.ts';
import {DomainError,requireIdempotencyKey,withIdempotentTransaction} from './transactions.ts';

const uuid='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
type SheetQuery={query?:string;category?:string;limit?:number;offset?:number;cursor?:string};
type SheetPatch={
 name:string;category:string;sku:string;color:string;size:string;
 barcode?:string|null;price_cents:number;
 expected_product_revision:number;expected_variant_revision:number;
};
type DbRow={
 product_id:string;variant_id:string;name:string;category:string;sku:string;color:string;size:string;
 barcode:string|null;price_cents:string;product_revision:string;variant_revision:string;
 stock_revision:string;on_hand:string;reserved:string;available:string;
 entries:string;sold:string;returns:string;adjustments:string;last_movement_at:Date|null;
};

const rowColumns=
 'p.id::text AS product_id,v.id::text AS variant_id,p.name,p.category,v.sku,v.color,v.size,v.barcode,'+
 'v.price_cents::text,p.revision::text AS product_revision,v.revision::text AS variant_revision,'+
 'coalesce(b.revision,0)::text AS stock_revision,'+
 'coalesce(b.on_hand,0)::text AS on_hand,coalesce(b.reserved,0)::text AS reserved,'+
 '(coalesce(b.on_hand,0)-coalesce(b.reserved,0))::text AS available,'+
 'coalesce(m.entries,0)::text AS entries,coalesce(m.sold,0)::text AS sold,'+
 'coalesce(m.returns,0)::text AS returns,coalesce(m.adjustments,0)::text AS adjustments,'+
 'm.last_movement_at';

function safeCount(value:string,field:string){
 const n=Number(value);
 if(!Number.isSafeInteger(n))throw new Error('Valor de '+field+' fora do intervalo seguro');
 return n;
}

type SheetCursor={name:string;sku:string;id:string};
function decodeSheetCursor(raw?:string):SheetCursor|null{
 if(!raw)return null;
 if(raw.length>512)throw new DomainError(400,'BAD_CURSOR','Cursor da planilha inválido');
 try{
  const entry=JSON.parse(Buffer.from(raw,'base64url').toString('utf8')) as SheetCursor;
  if(typeof entry.name!=='string'||entry.name.length>200||
    typeof entry.sku!=='string'||entry.sku.length>64||
    typeof entry.id!=='string'||!new RegExp(uuid).test(entry.id))throw Error('invalid');
  return entry;
 }catch{throw new DomainError(400,'BAD_CURSOR','Cursor da planilha inválido');}
}
function encodeSheetCursor(row:DbRow){
 return Buffer.from(JSON.stringify({name:row.name,sku:row.sku,id:row.variant_id})).toString('base64url');
}

export function registerStockSpreadsheet(app:FastifyInstance,db:Pool){
 app.get<{Querystring:SheetQuery}>('/v1/stock/spreadsheet',{
  schema:{querystring:{type:'object',additionalProperties:false,properties:{
   query:{type:'string',maxLength:100,default:''},
   category:{type:'string',maxLength:100,default:''},
   limit:{type:'integer',minimum:1,maximum:100,default:50},
   offset:{type:'integer',minimum:0,maximum:1000000,default:0},
   cursor:{type:'string',maxLength:512}
  }}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'stock.read'))return reply;
  const {query='',category='',limit=50,offset=0,cursor}=request.query,store=request.authContext!.storeId;
  const after=decodeSheetCursor(cursor);
  const args=[store,query.trim(),category.trim(),limit+1,after?0:offset,
   after?.name??null,after?.sku??null,after?.id??null];
  const filter="v.store_id=$1 AND ($2='' OR p.name ILIKE '%'||$2||'%' OR v.sku ILIKE '%'||$2||'%' OR v.barcode=$2) AND ($3='' OR p.category=$3)";
  const [count,records,categories]=await Promise.all([
   db.query<{total:string}>('SELECT count(*)::text AS total FROM product_variants v JOIN products p '+
    'ON p.id=v.product_id AND p.store_id=v.store_id WHERE '+filter,args.slice(0,3)),
   db.query<DbRow>('WITH page AS MATERIALIZED ('+
    'SELECT v.id FROM product_variants v JOIN products p ON p.id=v.product_id AND p.store_id=v.store_id WHERE '+
    filter+(after?' AND (p.name,v.sku,v.id) > ($6::text,$7::text,$8::uuid)':'')+
    ' ORDER BY p.name,v.sku,v.id LIMIT $4 OFFSET $5) '+
    'SELECT '+rowColumns+
    ' FROM page pg JOIN product_variants v ON v.id=pg.id AND v.store_id=$1 '+
    'JOIN products p ON p.id=v.product_id AND p.store_id=v.store_id '+
    'LEFT JOIN stock_balances b ON b.store_id=v.store_id AND b.variant_id=v.id '+
    'LEFT JOIN LATERAL ('+
    " SELECT coalesce(sum(CASE WHEN movement_kind='receipt' THEN qty_delta ELSE 0 END),0) AS entries,"+
    " coalesce(sum(CASE WHEN movement_kind='sale' THEN -qty_delta ELSE 0 END),0) AS sold,"+
    " coalesce(sum(CASE WHEN movement_kind='return' THEN qty_delta ELSE 0 END),0) AS returns,"+
    " coalesce(sum(CASE WHEN movement_kind='adjustment' THEN qty_delta ELSE 0 END),0) AS adjustments,"+
    ' max(occurred_at) AS last_movement_at FROM stock_movements m '+
    ' WHERE m.store_id=v.store_id AND m.variant_id=v.id'+
    ') m ON true ORDER BY p.name,v.sku,v.id',args),
   db.query<{category:string}>('SELECT DISTINCT category FROM products WHERE store_id=$1 ORDER BY category',[store])
  ]);
  const items=records.rows.slice(0,limit);
  return {total:safeCount(count.rows[0]?.total??'0','total'),limit,offset,categories:categories.rows.map(x=>x.category),
   next_cursor:records.rows.length>limit?encodeSheetCursor(items[items.length-1]):null,
   items:items.map(row=>({
    product_id:row.product_id,variant_id:row.variant_id,name:row.name,category:row.category,
    sku:row.sku,color:row.color,size:row.size,barcode:row.barcode,
    price_cents:safeCount(row.price_cents,'preço'),
    product_revision:safeCount(row.product_revision,'produto'),
    variant_revision:safeCount(row.variant_revision,'variante'),
    stock_revision:safeCount(row.stock_revision,'estoque'),
    on_hand:safeCount(row.on_hand,'saldo'),reserved:safeCount(row.reserved,'reservas'),
    available:safeCount(row.available,'disponível'),
    entries:safeCount(row.entries,'entradas'),sold:safeCount(row.sold,'vendas'),
    returns:safeCount(row.returns,'devoluções'),adjustments:safeCount(row.adjustments,'ajustes'),
    last_movement_at:row.last_movement_at?.toISOString()??null
   }))};
 });
 app.patch<{Params:{id:string};Body:SheetPatch}>('/v1/stock/spreadsheet/rows/:id',{
  schema:{
   params:{type:'object',additionalProperties:false,required:['id'],properties:{id:{type:'string',pattern:uuid}}},
   body:{type:'object',additionalProperties:false,required:[
    'name','category','sku','color','size','price_cents','expected_product_revision','expected_variant_revision'
   ],properties:{
    name:{type:'string',minLength:1,maxLength:200},category:{type:'string',minLength:1,maxLength:100},
    sku:{type:'string',minLength:1,maxLength:64},color:{type:'string',minLength:1,maxLength:100},
    size:{type:'string',minLength:1,maxLength:32},barcode:{type:['string','null'],maxLength:128},
    price_cents:{type:'integer',minimum:0,maximum:9999999999},
    expected_product_revision:{type:'integer',minimum:1},
    expected_variant_revision:{type:'integer',minimum:1}
   }}
  }
 },async(request,reply)=>{
  if(requirePermission(request,reply,'catalog.write'))return reply;
  const raw=request.body;
  const input={name:raw.name.trim().replace(/\s+/g,' '),
   category:raw.category.trim().replace(/\s+/g,' '),
   sku:raw.sku.trim().toUpperCase(),color:raw.color.trim().replace(/\s+/g,' '),
   size:raw.size.trim().replace(/\s+/g,' '),barcode:raw.barcode?.trim()||null,
   price_cents:raw.price_cents,
   expected_product_revision:raw.expected_product_revision,
   expected_variant_revision:raw.expected_variant_revision};
  if(!input.name||!input.category||!input.color||!input.size||!(/^[A-Z0-9_-]{1,64}$/.test(input.sku))||
    input.name.length>200||input.category.length>100||input.color.length>100||input.size.length>32)
   throw new DomainError(422,'INVALID_SHEET_ROW','Informe nome, categoria, SKU, cor e tamanho válidos');
  const auth=request.authContext!,id=request.params.id;
  const key=requireIdempotencyKey(request.headers['idempotency-key']);
  const result=await withIdempotentTransaction(db,auth,'catalog.spreadsheet.edit:'+id,key,input,async client=>{
   const found=await client.query<{
    product_id:string;product_revision:string;variant_revision:string;
    name:string;category:string;sku:string;color:string;size:string;barcode:string|null;price_cents:string;
   }>('SELECT p.id::text AS product_id,p.revision::text AS product_revision,v.revision::text AS variant_revision,'+
    'p.name,p.category,v.sku,v.color,v.size,v.barcode,v.price_cents::text '+
    'FROM products p JOIN product_variants v ON v.product_id=p.id AND v.store_id=p.store_id '+
    'WHERE v.store_id=$1 AND v.id=$2 FOR UPDATE OF p,v',[auth.storeId,id]);
   if(!found.rowCount)throw new DomainError(404,'VARIANT_NOT_FOUND','SKU não encontrado nesta loja');
   const old=found.rows[0];
   if(Number(old.product_revision)!==input.expected_product_revision||
      Number(old.variant_revision)!==input.expected_variant_revision)
    throw new DomainError(409,'REVISION_CONFLICT','Produto alterado por outro operador. Recarregue a planilha.');
   const changeProduct=old.name!==input.name||old.category!==input.category;
   const changeVariant=old.sku!==input.sku||old.color!==input.color||old.size!==input.size||
    old.barcode!==input.barcode||Number(old.price_cents)!==input.price_cents;
   let productRevision=Number(old.product_revision),variantRevision=Number(old.variant_revision);
   if(changeProduct){
    const updated=await client.query<{revision:string}>(
      'UPDATE products SET name=$3,category=$4,revision=revision+1 WHERE store_id=$1 AND id=$2 RETURNING revision::text',
      [auth.storeId,old.product_id,input.name,input.category]);
    productRevision=Number(updated.rows[0].revision);
    await client.query(
      "INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload) VALUES($1,'catalog.product.updated.v1',$2,$3,$4::jsonb)",
      [auth.storeId,old.product_id,productRevision,JSON.stringify({revision:productRevision})]);
   }
   if(changeVariant){
    const updated=await client.query<{revision:string}>(
      'UPDATE product_variants SET sku=$3,color=$4,size=$5,barcode=$6,price_cents=$7,revision=revision+1 '+
      'WHERE store_id=$1 AND id=$2 RETURNING revision::text',
      [auth.storeId,id,input.sku,input.color,input.size,input.barcode,input.price_cents]);
    variantRevision=Number(updated.rows[0].revision);
    await client.query(
      "INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload) VALUES($1,'catalog.variant.updated.v1',$2,$3,$4::jsonb)",
      [auth.storeId,id,variantRevision,JSON.stringify({revision:variantRevision})]);
   }
   if(changeProduct||changeVariant)await client.query(
    "INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail) VALUES($1,$2,'catalog.spreadsheet.edit',$3,$4::jsonb)",
    [auth.storeId,auth.userId,id,JSON.stringify({product_id:old.product_id,changeProduct,changeVariant})]);
   return {id,product_id:old.product_id,product_revision:productRevision,
    variant_revision:variantRevision,changed:changeProduct||changeVariant};
  });
  return {...result.result,replayed:result.replayed};
 });
}
