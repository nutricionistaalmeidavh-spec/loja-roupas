import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { requirePermission } from './auth.ts';
import { DomainError,requireIdempotencyKey,withIdempotentTransaction } from './transactions.ts';

const widgetNames=['seasonality','collections','suppliers','stock'] as const;
type Preferences={target_cents:number;low_stock_limit:number;widgets:Array<typeof widgetNames[number]>};
const defaults:Preferences={target_cents:0,low_stock_limit:3,widgets:[...widgetNames]};
const uuid={type:'string',pattern:'^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'};
type Period={period:string;gross_cents:string;refunded_cents:string};

function subtotal(rows:Period[]) {
  return rows.reduce((total,row)=>total+BigInt(row.gross_cents)-BigInt(row.refunded_cents),0n);
}

export function forecast28Days(days:Period[]) {
  if(days.length!==28)throw new Error('A projeção exige 28 dias completos');
  const first=subtotal(days.slice(0,14));
  const second=subtotal(days.slice(14));
  const activeDays=days.filter(day=>BigInt(day.gross_cents)>0n).length;
  if(activeDays<7)return {method:'trailing_28_days',active_days:activeDays,estimate_cents:null,low_cents:null,high_cents:null};
  const low=first<second?first:second;
  const high=first>second?first:second;
  return {method:'trailing_28_days',active_days:activeDays,estimate_cents:((first+second)/2n).toString(),
    low_cents:low.toString(),high_cents:high.toString()};
}

const seriesSql=`WITH config AS (
  SELECT id,timezone,(now() AT TIME ZONE timezone)::date AS today FROM stores WHERE id=$1
), calendar AS (
  SELECT day::date FROM config,generate_series(
    date_trunc('month', today)-interval '11 months',today::timestamp,interval '1 day') AS day
), movements AS (
  SELECT (s.created_at AT TIME ZONE c.timezone)::date AS day,s.total_cents AS gross,0::bigint AS refunded
  FROM sales s JOIN config c ON c.id=s.store_id
  WHERE s.status<>'cancelled' AND s.created_at >= (date_trunc('month', c.today)-interval '11 months') AT TIME ZONE c.timezone
  UNION ALL
  SELECT (r.created_at AT TIME ZONE c.timezone)::date,0,r.amount_cents
  FROM cash_sale_returns r JOIN config c ON c.id=r.store_id
  WHERE r.created_at >= (date_trunc('month', c.today)-interval '11 months') AT TIME ZONE c.timezone
)
SELECT d.day::text AS period,coalesce(sum(m.gross),0)::text AS gross_cents,coalesce(sum(m.refunded),0)::text AS refunded_cents
FROM calendar d LEFT JOIN movements m ON m.day=d.day GROUP BY d.day ORDER BY d.day`;

export function registerIntelligence(app:FastifyInstance,db:Pool) {
  app.get('/v1/management/intelligence',async(request,reply)=>{
    if(requirePermission(request,reply,'intelligence.read'))return reply;
    const id=request.authContext!.storeId;
    const [settings,series,collections,suppliers]=await Promise.all([
      db.query<Preferences>('SELECT target_cents,low_stock_limit,widgets FROM commercial_preferences WHERE store_id=$1',[id]),
      db.query<Period>(seriesSql,[id]),
      db.query(`SELECT coalesce(p.collection_name,'Sem coleção') AS name,sum(l.quantity)::text AS units,
          sum(l.line_total_cents)::text AS revenue_cents
        FROM sales s JOIN sale_lines l ON l.sale_id=s.id AND l.store_id=s.store_id
        JOIN product_variants v ON v.id=l.variant_id AND v.store_id=l.store_id
        JOIN products p ON p.id=v.product_id AND p.store_id=v.store_id
        WHERE s.store_id=$1 AND s.status='confirmed' AND s.created_at>=now()-interval '90 days'
        GROUP BY coalesce(p.collection_name,'Sem coleção') ORDER BY sum(l.line_total_cents) DESC,name LIMIT 20`,[id]),
      db.query(`SELECT s.id,s.name,count(p.id)::integer AS orders,count(p.received_at)::integer AS received,
          CASE WHEN count(p.received_at)>=3 THEN round(avg(extract(epoch FROM (p.received_at-p.created_at))/86400),1)::text END AS average_days
        FROM suppliers s LEFT JOIN purchase_orders p ON p.supplier_id=s.id AND p.store_id=s.store_id
          AND p.created_at>=now()-interval '90 days'
        WHERE s.store_id=$1 GROUP BY s.id,s.name ORDER BY count(p.id) DESC,s.name,s.id LIMIT 30`,[id]),
    ]);
    const row=settings.rows[0];
    const preferences=row?{...row,target_cents:Number(row.target_cents)}:defaults;
    const stock=await db.query(`SELECT v.id,v.sku,p.name,(coalesce(b.on_hand,0)-coalesce(b.reserved,0))::text AS available
      FROM product_variants v JOIN products p ON p.id=v.product_id AND p.store_id=v.store_id
      LEFT JOIN stock_balances b ON b.store_id=v.store_id AND b.variant_id=v.id
      WHERE v.store_id=$1 AND coalesce(b.on_hand,0)-coalesce(b.reserved,0)<=$2
      ORDER BY coalesce(b.on_hand,0)-coalesce(b.reserved,0),v.sku,v.id LIMIT 30`,[id,preferences.low_stock_limit]);
    const months=new Map<string,{gross:bigint;refund:bigint}>();
    for(const day of series.rows){
      const period=day.period.slice(0,7)+'-01';
      const totals=months.get(period)??{gross:0n,refund:0n};
      totals.gross+=BigInt(day.gross_cents);totals.refund+=BigInt(day.refunded_cents);
      months.set(period,totals);
    }
    return {preferences,daily:series.rows.slice(-29),months:[...months].map(([period,totals])=>({
      period,gross_cents:totals.gross.toString(),refunded_cents:totals.refund.toString()})),
      forecast:forecast28Days(series.rows.slice(-29,-1)),collections:collections.rows,suppliers:suppliers.rows,low_stock:stock.rows};
  });

  app.put<{Body:Preferences}>('/v1/management/intelligence',{
    schema:{body:{type:'object',additionalProperties:false,required:['target_cents','low_stock_limit','widgets'],properties:{
      target_cents:{type:'integer',minimum:0,maximum:9999999999},
      low_stock_limit:{type:'integer',minimum:0,maximum:999},
      widgets:{type:'array',maxItems:4,uniqueItems:true,items:{type:'string',enum:widgetNames}},
    }}},
  },async(request,reply)=>{
    if(requirePermission(request,reply,'intelligence.manage'))return reply;
    const auth=request.authContext!,body=request.body,key=requireIdempotencyKey(request.headers['idempotency-key']);
    const out=await withIdempotentTransaction(db,auth,'intelligence.preferences',key,body,async client=>{
      await client.query(`INSERT INTO commercial_preferences(store_id,target_cents,low_stock_limit,widgets)
        VALUES($1,$2,$3,$4) ON CONFLICT(store_id) DO UPDATE SET target_cents=EXCLUDED.target_cents,
        low_stock_limit=EXCLUDED.low_stock_limit,widgets=EXCLUDED.widgets`,
        [auth.storeId,body.target_cents,body.low_stock_limit,body.widgets]);
      await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
        VALUES($1,$2,'intelligence.preferences',$1,$3::jsonb)`,[auth.storeId,auth.userId,JSON.stringify(body)]);
      return body;
    });
    return out.result;
  });

  app.put<{Params:{id:string};Body:{collection:string}}>('/v1/management/intelligence/products/:id/collection',{
    schema:{params:{type:'object',required:['id'],properties:{id:uuid}},body:{type:'object',additionalProperties:false,
      required:['collection'],properties:{collection:{type:'string',maxLength:80}}}},
  },async(request,reply)=>{
    if(requirePermission(request,reply,'intelligence.manage'))return reply;
    const auth=request.authContext!,{id}=request.params,key=requireIdempotencyKey(request.headers['idempotency-key']);
    const collection=request.body.collection.trim()||null;
    const out=await withIdempotentTransaction(db,auth,'intelligence.collection:'+id,key,{collection},async client=>{
      const updated=await client.query(`UPDATE products SET collection_name=$3 WHERE store_id=$1 AND id=$2 RETURNING id`,
        [auth.storeId,id,collection]);
      if(!updated.rowCount)throw new DomainError(404,'PRODUCT_NOT_FOUND','Produto indisponível nesta loja');
      await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
        VALUES($1,$2,'intelligence.collection',$3,$4::jsonb)`,[auth.storeId,auth.userId,id,JSON.stringify({collection})]);
      return {id,collection};
    });
    return out.result;
  });
}
