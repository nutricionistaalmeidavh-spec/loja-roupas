import type { FastifyInstance } from 'fastify';
import type { Pool,PoolClient } from 'pg';
import { requirePermission } from './auth.ts';
import type { AuthContext } from './auth.ts';
import { DomainError, requireIdempotencyKey, withIdempotentTransaction } from './transactions.ts';

const uid='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
type Line={variant_id:string;quantity:number;expected_price_cents:number;expected_price_revision:number};
type QuoteLine={variant_id:string;quantity:number};
type Pay={method:'cash'|'pix_manual'|'card_external';amount_cents:number;confirmed:boolean;external_reference?:string};
type Commit={cash_session_id:string;lines:Line[];payments:Pay[]};
type VariantRow={id:string;price_cents:string;revision:string;sku:string;color:string;size:string;name:string;available:string};
type SaleRow={id:string;store_id:string;sale_number:string;status:string;total_cents:string;tendered_cents:string;
 change_cents:string;created_at:Date;cash_session_id:string};
function exactInteger(value:number,minimum=0){return Number.isSafeInteger(value)&&value>=minimum;}
function validateLines(lines:readonly QuoteLine[]){
 if(lines.length<1||lines.length>100)throw new DomainError(422,'LINES_INVALID','Informe de 1 a 100 itens');
 if(new Set(lines.map(l=>l.variant_id)).size!==lines.length)throw new DomainError(422,'DUPLICATE_VARIANT','Junte quantidades da mesma variante');
 for(const line of lines)if(!exactInteger(line.quantity,1)||line.quantity>10000)
  throw new DomainError(422,'QUANTITY_INVALID','Quantidade inválida');
}
function validatePayments(payments:readonly Pay[],total:number) {
 if(payments.length<1||payments.length>6)throw new DomainError(422,'PAYMENTS_INVALID','Informe de 1 a 6 parcelas');
 let tendered=0,cash=0,noncash=0,cashCount=0;
 for(const payment of payments){
  if(!exactInteger(payment.amount_cents,1)||payment.confirmed!==true)
   throw new DomainError(422,'PAYMENT_UNCONFIRMED','Valor e recebimento precisam de confirmação explícita');
  if(payment.method!=='cash'&&payment.method!=='pix_manual'&&payment.method!=='card_external')
   throw new DomainError(422,'METHOD_NOT_SUPPORTED','Meio de pagamento não está habilitado');
  if(payment.method==='cash'){cash+=payment.amount_cents;cashCount++;}
  else{
   if(!payment.external_reference || payment.external_reference.trim().length<6 ||
       payment.external_reference.trim().length>128)
    throw new DomainError(422,'PAYMENT_REFERENCE','Informe comprovante ou referência de confirmação externa');
   noncash+=payment.amount_cents;
  }
  tendered+=payment.amount_cents;
 }
 if(cashCount>1||!exactInteger(tendered)||!exactInteger(cash)||!exactInteger(noncash))
  throw new DomainError(422,'PAYMENTS_INVALID','Valores de pagamentos inválidos');
 if(noncash>total||tendered<total||tendered-total>cash)
  throw new DomainError(422,'PAYMENTS_MISMATCH','Pagamentos não cobrem o total ou troco excede dinheiro');
 return {tendered,change:tendered-total};
}
async function variantData(db:Pick<PoolClient,'query'>,store:string,id:string,lock:boolean){
 const result=await db.query<VariantRow>(`SELECT v.id::text,v.price_cents::text,v.revision::text,
  v.sku,v.color,v.size,p.name,(coalesce(s.on_hand,0)-coalesce(s.reserved,0))::text AS available
  FROM product_variants v
  JOIN products p ON p.id=v.product_id AND p.store_id=v.store_id
  LEFT JOIN stock_balances s ON s.variant_id=v.id AND s.store_id=v.store_id
  WHERE v.id=$1 AND v.store_id=$2
  ${lock?'FOR SHARE OF v':''}`,[id,store]);
 if(!result.rowCount)throw new DomainError(404,'VARIANT_NOT_FOUND','Variante não encontrada nesta loja');
 return result.rows[0];
}
function toMoney(value:string){const num=Number(value);if(!exactInteger(num))throw new DomainError(409,'MONEY_OVERFLOW','Valor monetário excede limites');return num;}
function validateCashOwner(auth:AuthContext,openedBy:string){
 if(!auth.roles.includes('manager')&&auth.userId!==openedBy)
  throw new DomainError(403,'CASH_OWNER','Este caixa pertence a outro operador');
}
async function readSale(db:Pick<Pool,'query'>,store:string,id:string){
 const row=await db.query<SaleRow>(`SELECT id::text,store_id::text,sale_number::text,status,
  total_cents::text,tendered_cents::text,change_cents::text,created_at,cash_session_id::text
  FROM sales WHERE id=$1 AND store_id=$2`,[id,store]);
 if(!row.rowCount)throw new DomainError(404,'SALE_NOT_FOUND','Venda não encontrada');
 const lines=await db.query<{product_name:string;sku:string;color:string;size:string;quantity:string;unit_price_cents:string;line_total_cents:string}>(
  `SELECT product_name,sku,color,size,quantity::text,unit_price_cents::text,line_total_cents::text
   FROM sale_lines WHERE sale_id=$1 AND store_id=$2 ORDER BY id`,[id,store]);
 const payments=await db.query<{method:string;amount_cents:string;external_reference:string|null}>(
  `SELECT method,amount_cents::text,external_reference FROM sale_payments WHERE sale_id=$1 AND store_id=$2 ORDER BY id`,[id,store]);
 const sale=row.rows[0];
 return {id:sale.id,sale_number:Number(sale.sale_number),status:sale.status,cash_session_id:sale.cash_session_id,
  total_cents:toMoney(sale.total_cents),tendered_cents:toMoney(sale.tendered_cents),
  change_cents:toMoney(sale.change_cents),created_at:sale.created_at,
  lines:lines.rows.map(l=>({...l,quantity:Number(l.quantity),unit_price_cents:toMoney(l.unit_price_cents),
   line_total_cents:toMoney(l.line_total_cents)})),
  payments:payments.rows.map(p=>({...p,amount_cents:toMoney(p.amount_cents)}))};
}
const quoteLines={type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,required:['variant_id','quantity'],
 properties:{variant_id:{type:'string',pattern:uid},quantity:{type:'integer',minimum:1,maximum:10000}}}} as const;
export function registerSales(app:FastifyInstance,db:Pool){
 app.post<{Body:{lines:QuoteLine[]}}>('/v1/sales/quotes',{
  schema:{body:{type:'object',additionalProperties:false,required:['lines'],properties:{lines:quoteLines}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'sale.commit'))return reply;
  validateLines(request.body.lines);
  let total=0;
  const lines=[];
  for(const line of request.body.lines){
   const item=await variantData(db,request.authContext!.storeId,line.variant_id,false);
   const price=toMoney(item.price_cents),available=toMoney(item.available),priceRevision=Number(item.revision);
   const subtotal=line.quantity*price;
   if(!Number.isSafeInteger(subtotal)||!Number.isSafeInteger(total+subtotal))
    throw new DomainError(422,'TOTAL_OVERFLOW','Total excede limite permitido');
   total+=subtotal;
   lines.push({variant_id:line.variant_id,quantity:line.quantity,sku:item.sku,product_name:item.name,
    price_cents:price,price_revision:priceRevision,available});
  }
  return {total_cents:total,can_commit:lines.every(l=>l.available>=l.quantity),lines};
 });
 app.post<{Body:Commit}>('/v1/sales',{
  schema:{body:{type:'object',additionalProperties:false,required:['cash_session_id','lines','payments'],properties:{
   cash_session_id:{type:'string',pattern:uid},
   lines:{type:'array',minItems:1,maxItems:100,items:{
    type:'object',additionalProperties:false,required:['variant_id','quantity','expected_price_cents','expected_price_revision'],
    properties:{variant_id:{type:'string',pattern:uid},quantity:{type:'integer',minimum:1,maximum:10000},
     expected_price_cents:{type:'integer',minimum:0},expected_price_revision:{type:'integer',minimum:1}}
   }},
   payments:{type:'array',minItems:1,maxItems:6,items:{
    type:'object',additionalProperties:false,required:['method','amount_cents','confirmed'],
    properties:{method:{type:'string',enum:['cash','pix_manual','card_external']},
     amount_cents:{type:'integer',minimum:1},confirmed:{type:'boolean'},
     external_reference:{type:'string',maxLength:128}}
   }}
  }}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'sale.commit'))return reply;
  const auth=request.authContext!,body=request.body;
  validateLines(body.lines);
  const key=requireIdempotencyKey(request.headers['idempotency-key']);
  const out=await withIdempotentTransaction(db,auth,'sale.commit',key,body,async client=>{
   const cash=await client.query<{id:string;opened_by:string;closed_at:Date|null}>(`SELECT id::text,opened_by::text,closed_at
    FROM cash_sessions WHERE id=$1 AND store_id=$2 FOR UPDATE`,[body.cash_session_id,auth.storeId]);
   if(!cash.rowCount||cash.rows[0].closed_at)
    throw new DomainError(409,'CASH_CLOSED','Abra o caixa antes de confirmar a venda');
   validateCashOwner(auth,cash.rows[0].opened_by);
   const sorted=[...body.lines].sort((a,b)=>a.variant_id.localeCompare(b.variant_id));
   const priced:{line:Line;row:VariantRow;price:number;subtotal:number}[]=[];
   let total=0;
   for(const line of sorted){
    const row=await variantData(client,auth.storeId,line.variant_id,true);
    const balance=await client.query<{on_hand:string;reserved:string}>(`SELECT on_hand::text,reserved::text FROM stock_balances
     WHERE store_id=$1 AND variant_id=$2 FOR UPDATE`,[auth.storeId,line.variant_id]);
    if(!balance.rowCount||Number(balance.rows[0].on_hand)-Number(balance.rows[0].reserved)<line.quantity)
     throw new DomainError(409,'OUT_OF_STOCK','Quantidade indisponível para a variante '+row.sku);
    const price=toMoney(row.price_cents);
    if(price!==line.expected_price_cents||Number(row.revision)!==line.expected_price_revision)
     throw new DomainError(409,'PRICE_CHANGED','Preço da peça mudou. Atualize a cotação antes de confirmar');
    const subtotal=price*line.quantity;
    if(!exactInteger(subtotal)||!exactInteger(total+subtotal))
     throw new DomainError(422,'TOTAL_OVERFLOW','Valor da venda excede os limites');
    total+=subtotal;priced.push({line,row,price,subtotal});
   }
   const {tendered,change}=validatePayments(body.payments,total);
   const num=await client.query<{last_number:string}>(`INSERT INTO store_counters(store_id,counter_name,last_number)
     VALUES($1,'sale',1) ON CONFLICT(store_id,counter_name) DO UPDATE SET
     last_number=store_counters.last_number+1 RETURNING last_number::text`,[auth.storeId]);
   const number=toMoney(num.rows[0].last_number);
   const created=await client.query<{id:string;created_at:Date}>(`INSERT INTO sales
    (store_id,sale_number,cash_session_id,cashier_id,total_cents,tendered_cents,change_cents)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id::text,created_at`,
    [auth.storeId,number,body.cash_session_id,auth.userId,total,tendered,change]);
   const saleId=created.rows[0].id;
   for(const x of priced){
    await client.query(`INSERT INTO sale_lines(store_id,sale_id,variant_id,product_name,sku,color,size,
      quantity,unit_price_cents,line_total_cents)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
     [auth.storeId,saleId,x.line.variant_id,x.row.name,x.row.sku,x.row.color,x.row.size,
      x.line.quantity,x.price,x.subtotal]);
    const balance=await client.query<{revision:string}>(`UPDATE stock_balances
      SET on_hand=on_hand-$3,revision=revision+1
      WHERE store_id=$1 AND variant_id=$2 AND on_hand-reserved>=$3 RETURNING revision::text`,
     [auth.storeId,x.line.variant_id,x.line.quantity]);
    if(!balance.rowCount)throw new DomainError(409,'OUT_OF_STOCK','Saldo alterado simultaneamente');
    await client.query(`INSERT INTO stock_movements(store_id,variant_id,source_type,source_id,movement_kind,qty_delta)
      VALUES($1,$2,'sale',$3,'sale',$4)`,[auth.storeId,x.line.variant_id,saleId,-x.line.quantity]);
    await client.query(`INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload)
      VALUES($1,'inventory.stock.changed.v1',$2,$3,$4::jsonb)`,
      [auth.storeId,x.line.variant_id,Number(balance.rows[0].revision),JSON.stringify({sale_id:saleId})]);
   }
   for(const payment of body.payments){
    await client.query(`INSERT INTO sale_payments(store_id,sale_id,method,amount_cents,external_reference,confirmed_manually)
     VALUES($1,$2,$3,$4,$5,true)`,[auth.storeId,saleId,payment.method,payment.amount_cents,
      payment.method==='cash'?null:payment.external_reference!.trim()]);
   }
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
     VALUES($1,$2,'sales.confirm',$3,$4::jsonb)`,
    [auth.storeId,auth.userId,saleId,JSON.stringify({number,total,change,cash_session_id:body.cash_session_id})]);
   await client.query(`INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload)
     VALUES($1,'sales.sale.confirmed.v1',$2,1,$3::jsonb)`,
    [auth.storeId,saleId,JSON.stringify({sale_number:number,total_cents:total})]);
   return {id:saleId,sale_number:number,status:'confirmed',total_cents:total,tendered_cents:tendered,
    change_cents:change,created_at:created.rows[0].created_at,cash_session_id:body.cash_session_id};
  });
  return reply.code(201).send(out.result);
 });
 app.get<{Params:{id:string}}>('/v1/sales/:id',{
  schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',pattern:uid}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'sale.read'))return reply;
  return readSale(db,request.authContext!.storeId,request.params.id);
 });
 app.get<{Params:{id:string}}>('/v1/sales/:id/receipt',{
  schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',pattern:uid}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'sale.read'))return reply;
  const sale=await readSale(db,request.authContext!.storeId,request.params.id);
  const money=(n:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
  const body=[
    'LOJA DE ROUPAS','COMPROVANTE NÃO FISCAL','Não substitui documento fiscal quando exigido.',
    '--------------------------------',
    'Venda Nº '+sale.sale_number,
    'Data: '+new Date(sale.created_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}),
    ...sale.lines.map(l=>l.quantity+' × '+l.product_name+' ('+l.color+'/'+l.size+') '+money(l.line_total_cents)),
    '--------------------------------','TOTAL '+money(sale.total_cents),
    ...sale.payments.map(p=>p.method+' '+money(p.amount_cents)),
    'TROCO '+money(sale.change_cents),
    'ID: '+sale.id,
  ].join('\n');
  return reply.header('cache-control','private,no-store').type('text/plain; charset=utf-8').send(body);
 });
}
