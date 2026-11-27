import { formatReceipt, RECEIPT_COLUMNS } from './receipt-format.ts';
import type { ReceiptRow } from './receipt-format.ts';
import type { FastifyInstance } from 'fastify';
import type { Pool,PoolClient } from 'pg';
import { requirePermission } from './auth.ts';
import type { AuthContext } from './auth.ts';
import { validatePickupSale } from './pickup-orders.ts';
import { DomainError, requireIdempotencyKey, withIdempotentTransaction } from './transactions.ts';
import {allocateDiscounts,commissionCents,creditInstallments,loyaltyPoints} from './retail-rules.ts';
import {linePromotions} from './promotions.ts';
import {consumeHolds,releasePickupReservation,sweepExpiredReservations,sweepExpiredReservationsTx} from './reservations.ts';

const uid='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
type Line={variant_id:string;quantity:number;expected_price_cents:number;expected_price_revision:number;discount_cents?:number};
type QuoteLine={variant_id:string;quantity:number;discount_cents?:number};
type Pay={method:'cash'|'pix_manual'|'card_external'|'store_credit'|'customer_credit';amount_cents:number;confirmed:boolean;external_reference?:string};
type Commit={cash_session_id:string;pickup_order_id?:string;customer_id?:string;seller_id?:string;
 discount_cents?:number;discount_reason?:string;stock_hold_ids?:string[];
 credit_installments?:Array<{due_on:string;amount_cents:number}>;lines:Line[];payments:Pay[]};
type VariantRow={id:string;price_cents:string;revision:string;sku:string;color:string;size:string;name:string;available:string;cost_cents:string|null};
type SaleRow={id:string;store_id:string;sale_number:string;status:string;total_cents:string;tendered_cents:string;
 change_cents:string;created_at:Date;cash_session_id:string};
export const PAYMENT_LABELS:Record<string,string>={cash:'DINHEIRO',pix_manual:'PIX',card_external:'CARTÃO',
 store_credit:'CREDIÁRIO A RECEBER',customer_credit:'CRÉDITO DO CLIENTE',exchange_credit:'CRÉDITO DA TROCA'};
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
  if(!['cash','pix_manual','card_external','store_credit','customer_credit'].includes(payment.method))
   throw new DomainError(422,'METHOD_NOT_SUPPORTED','Meio de pagamento não está habilitado');
  if(payment.method==='cash'){cash+=payment.amount_cents;cashCount++;}
  else if(payment.method==='store_credit'||payment.method==='customer_credit'){
   if(payment.external_reference)throw new DomainError(422,'PAYMENT_REFERENCE','Crédito da loja não aceita referência externa');
   noncash+=payment.amount_cents;
  }else{
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
  v.sku,v.color,v.size,p.name,v.cost_cents::text,(coalesce(s.on_hand,0)-coalesce(s.reserved,0))::text AS available
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
 properties:{variant_id:{type:'string',pattern:uid},quantity:{type:'integer',minimum:1,maximum:10000},
  discount_cents:{type:'integer',minimum:0}}}} as const;
/** Aplica desconto por linha e no total; confere o limite do caixa e a justificativa. */
export async function applySaleDiscounts(db:Pick<PoolClient,'query'>,auth:AuthContext,
 gross:ReadonlyArray<{gross_cents:number;discount_cents:number}>,orderDiscount:number,reason:string|undefined,enforce:boolean){
 const perLine=allocateDiscounts(gross,orderDiscount);
 const subtotal=gross.reduce((n,l)=>n+l.gross_cents,0);
 const discount=perLine.reduce((n,d)=>n+d,0);
 const total=subtotal-discount;
 const store=await db.query<{max_cashier_discount_bps:number}>('SELECT max_cashier_discount_bps FROM stores WHERE id=$1',[auth.storeId]);
 const limit=store.rows[0]?.max_cashier_discount_bps??0;
 const needsManager=discount>0&&discount*10000>subtotal*limit;
 if(enforce&&discount>0){
  if(!reason||reason.trim().length<3)throw new DomainError(422,'DISCOUNT_REASON','Informe o motivo do desconto');
  if(needsManager&&!auth.roles.includes('manager'))
   throw new DomainError(403,'DISCOUNT_LIMIT','Desconto acima do limite do caixa ('+(limit/100).toLocaleString('pt-BR')+'%). Peça ao gestor.');
  if(total<1)throw new DomainError(422,'DISCOUNT_TOO_HIGH','A venda não pode ficar com valor zero');
 }
 return {perLine,subtotal,discount,total,needsManager,limit_bps:limit};
}
export function registerSales(app:FastifyInstance,db:Pool){
 app.post<{Body:{lines:QuoteLine[];discount_cents?:number;pickup_order_id?:string}}>('/v1/sales/quotes',{
  schema:{body:{type:'object',additionalProperties:false,required:['lines'],properties:{lines:quoteLines,
   discount_cents:{type:'integer',minimum:0},pickup_order_id:{type:'string',pattern:uid}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'sale.commit'))return reply;
  validateLines(request.body.lines);
  const auth=request.authContext!;
  await sweepExpiredReservationsTx(db,auth.storeId);
  // Peças já separadas para este pedido de retirada contam como disponíveis para a própria venda.
  const ownReserved=new Map<string,number>();
  if(request.body.pickup_order_id){
   const r=await db.query<{variant_id:string;quantity:string}>(`SELECT l.variant_id::text,sum(l.quantity)::text AS quantity
    FROM pickup_order_lines l JOIN pickup_orders o ON o.id=l.order_id AND o.store_id=l.store_id
    WHERE o.store_id=$1 AND o.id=$2 AND o.reservation_released_at IS NULL AND o.sale_id IS NULL GROUP BY l.variant_id`,
    [auth.storeId,request.body.pickup_order_id]);
   for(const row of r.rows)ownReserved.set(row.variant_id.toLowerCase(),Number(row.quantity));
  }
  let gross=0;
  const lines=[];
  for(const line of request.body.lines){
   const item=await variantData(db,auth.storeId,line.variant_id,false);
   const price=toMoney(item.price_cents),priceRevision=Number(item.revision);
   const available=toMoney(item.available)+(ownReserved.get(line.variant_id.toLowerCase())??0);
   const subtotal=line.quantity*price;
   if(!Number.isSafeInteger(subtotal)||!Number.isSafeInteger(gross+subtotal))
    throw new DomainError(422,'TOTAL_OVERFLOW','Total excede limite permitido');
   gross+=subtotal;
   lines.push({variant_id:line.variant_id,quantity:line.quantity,sku:item.sku,product_name:item.name,
    color:item.color,size:item.size,price_cents:price,price_revision:priceRevision,available,
    gross_cents:subtotal,discount_cents:line.discount_cents??0});
  }
  const promo=await linePromotions(db,auth.storeId,lines);
  const promoTotal=promo.cents.reduce((n,c)=>n+c,0);
  const d=await applySaleDiscounts(db,auth,lines.map((l,i)=>({...l,gross_cents:l.gross_cents-promo.cents[i]})),request.body.discount_cents??0,undefined,false);
  return {subtotal_cents:gross,discount_cents:promoTotal+d.discount,promotion_cents:promoTotal,total_cents:d.total,
   discount_requires_manager:d.needsManager,cashier_discount_limit_bps:d.limit_bps,
   can_commit:lines.every(l=>l.available>=l.quantity),
   lines:lines.map((l,i)=>({...l,promotion_name:promo.names[i],promotion_cents:promo.cents[i],
    discount_cents:d.perLine[i]+promo.cents[i],line_total_cents:l.gross_cents-d.perLine[i]-promo.cents[i]}))};
 });
 app.post<{Body:Commit}>('/v1/sales',{
  schema:{body:{type:'object',additionalProperties:false,required:['cash_session_id','lines','payments'],properties:{
   cash_session_id:{type:'string',pattern:uid},pickup_order_id:{type:'string',pattern:uid},
   discount_cents:{type:'integer',minimum:0},discount_reason:{type:'string',maxLength:160},
   stock_hold_ids:{type:'array',maxItems:100,uniqueItems:true,items:{type:'string',pattern:uid}},
   customer_id:{type:'string',pattern:uid},seller_id:{type:'string',pattern:uid},
   credit_installments:{type:'array',minItems:1,maxItems:24,items:{
    type:'object',additionalProperties:false,required:['amount_cents','due_on'],
    properties:{amount_cents:{type:'integer',minimum:1},due_on:{type:'string',maxLength:10}}}},
   lines:{type:'array',minItems:1,maxItems:100,items:{
    type:'object',additionalProperties:false,required:['variant_id','quantity','expected_price_cents','expected_price_revision'],
    properties:{variant_id:{type:'string',pattern:uid},quantity:{type:'integer',minimum:1,maximum:10000},
     expected_price_cents:{type:'integer',minimum:0},expected_price_revision:{type:'integer',minimum:1},
     discount_cents:{type:'integer',minimum:0}}
   }},
   payments:{type:'array',minItems:1,maxItems:6,items:{
    type:'object',additionalProperties:false,required:['method','amount_cents','confirmed'],
    properties:{method:{type:'string',enum:['cash','pix_manual','card_external','store_credit','customer_credit']},
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
   await sweepExpiredReservations(client,auth.storeId);
   if(body.pickup_order_id){
    await validatePickupSale(client,auth.storeId,body.pickup_order_id,body.lines);
    await releasePickupReservation(client,auth.storeId,body.pickup_order_id,'sold');
   }
   if(body.stock_hold_ids?.length)await consumeHolds(client,auth,body.stock_hold_ids,body.lines);
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
   const promo=await linePromotions(client,auth.storeId,priced.map(x=>({variant_id:x.line.variant_id,quantity:x.line.quantity,price_cents:x.price})));
   const promoTotal=promo.cents.reduce((n,c)=>n+c,0);
   const manual=await applySaleDiscounts(client,auth,priced.map((x,i)=>({gross_cents:x.subtotal-promo.cents[i],discount_cents:x.line.discount_cents??0})),
    body.discount_cents??0,body.discount_reason,true);
   const discounts={...manual,discount:manual.discount+promoTotal,perLine:manual.perLine.map((c,i)=>c+promo.cents[i])};
   const promoNames=[...new Set(promo.names.filter((n):n is string=>Boolean(n)))];
   const discountReason=manual.discount?body.discount_reason!.trim():promoTotal?('Promoção: '+promoNames.join(', ')).slice(0,160):null;
   const subtotalCents=total;total=discounts.total;
   const {tendered,change}=validatePayments(body.payments,total);
   const storeCredit=body.payments.filter(p=>p.method==='store_credit').reduce((sum,p)=>sum+p.amount_cents,0);
   const loyaltyCredit=body.payments.filter(p=>p.method==='customer_credit').reduce((sum,p)=>sum+p.amount_cents,0);
   if(body.payments.filter(p=>p.method==='store_credit').length>1||
      body.payments.filter(p=>p.method==='customer_credit').length>1)
    throw new DomainError(422,'CREDIT_DUPLICATE','Consolide pagamentos em crédito por tipo');
   if((storeCredit||loyaltyCredit)&&!body.customer_id)
    throw new DomainError(422,'CUSTOMER_REQUIRED','Identifique o cliente para crédito ou crediário');
   if(storeCredit&&!auth.roles.includes('manager'))
    throw new DomainError(403,'CREDIT_APPROVAL','Somente o gestor pode conceder crediário');
   const installments=storeCredit?creditInstallments(storeCredit,body.credit_installments||[]):[];
   if(!storeCredit&&body.credit_installments?.length)
    throw new DomainError(422,'UNEXPECTED_INSTALLMENTS','Parcelas sem venda a crediário');
   let loyaltyAllowed=false;
   if(body.customer_id){
    const customer=await client.query<{loyalty_opt_in:boolean}>(`SELECT loyalty_opt_in
     FROM retail_customers WHERE store_id=$1 AND id=$2 AND anonymized_at IS NULL FOR UPDATE`,
     [auth.storeId,body.customer_id]);
    if(!customer.rowCount)throw new DomainError(404,'CUSTOMER_NOT_FOUND','Cliente não encontrado');
    loyaltyAllowed=customer.rows[0].loyalty_opt_in;
   }
   if(storeCredit){
    const limit=await client.query<{enabled:boolean;credit_limit_cents:string}>(`SELECT enabled,
     credit_limit_cents::text FROM retail_credit_limits WHERE store_id=$1 AND customer_id=$2 FOR UPDATE`,
     [auth.storeId,body.customer_id]);
    if(!limit.rowCount||!limit.rows[0].enabled)
     throw new DomainError(409,'CREDIT_DISABLED','Crediário não autorizado para este cliente');
    const owed=await client.query<{outstanding:string}>(`SELECT coalesce(sum(amount_cents-settled_cents),0)::text AS outstanding
     FROM retail_accounts WHERE store_id=$1 AND customer_id=$2 AND kind='receivable' AND cancelled_at IS NULL`,
     [auth.storeId,body.customer_id]);
    if(Number(owed.rows[0].outstanding)+storeCredit>Number(limit.rows[0].credit_limit_cents))
     throw new DomainError(409,'CREDIT_LIMIT','Limite de crediário insuficiente');
   }
   if(loyaltyCredit){
    const credits=await client.query<{id:string;remaining:string}>(`SELECT id::text,
     (amount_cents-used_cents)::text AS remaining FROM retail_customer_credits
     WHERE store_id=$1 AND customer_id=$2 AND used_cents<amount_cents
     ORDER BY created_at,id FOR UPDATE`,[auth.storeId,body.customer_id]);
    if(credits.rows.reduce((n,c)=>n+Number(c.remaining),0)<loyaltyCredit)
     throw new DomainError(409,'CUSTOMER_CREDIT_LOW','Saldo de crédito do cliente insuficiente');
    let remaining=loyaltyCredit;
    for(const credit of credits.rows){
     const used=Math.min(remaining,Number(credit.remaining));
     if(!used)continue;
     await client.query(`UPDATE retail_customer_credits SET used_cents=used_cents+$3
      WHERE store_id=$1 AND id=$2`,[auth.storeId,credit.id,used]);
     remaining-=used;
     if(!remaining)break;
    }
   }
   const sellerId=body.seller_id||auth.userId;
   const seller=await client.query(`SELECT 1 FROM user_store_roles r JOIN users u ON u.id=r.user_id
    WHERE r.store_id=$1 AND r.user_id=$2 AND u.status='active'`,[auth.storeId,sellerId]);
   if(!seller.rowCount)throw new DomainError(404,'SELLER_NOT_FOUND','Vendedor não pertence a esta loja');
   const num=await client.query<{last_number:string}>(`INSERT INTO store_counters(store_id,counter_name,last_number)
     VALUES($1,'sale',1) ON CONFLICT(store_id,counter_name) DO UPDATE SET
     last_number=store_counters.last_number+1 RETURNING last_number::text`,[auth.storeId]);
   const number=toMoney(num.rows[0].last_number);
   const created=await client.query<{id:string;created_at:Date}>(`INSERT INTO sales
    (store_id,sale_number,cash_session_id,cashier_id,total_cents,tendered_cents,change_cents,customer_id,seller_id,
     subtotal_cents,discount_cents,discount_reason,discount_by,promotion_cents)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id::text,created_at`,
    [auth.storeId,number,body.cash_session_id,auth.userId,total,tendered,change,body.customer_id||null,sellerId,
     subtotalCents,discounts.discount,discountReason,manual.discount?auth.userId:null,promoTotal]);
   const saleId=created.rows[0].id;
   if(body.pickup_order_id)await client.query('UPDATE pickup_orders SET sale_id=$3 WHERE store_id=$1 AND id=$2',
     [auth.storeId,body.pickup_order_id,saleId]);
   for(const [index,x] of priced.entries()){
    const lineDiscount=discounts.perLine[index];
    const lastCost=await client.query<{unit_cost_cents:string}>(`SELECT unit_cost_cents::text
     FROM purchase_orders WHERE store_id=$1 AND variant_id=$2 AND quality_finalized=true
     ORDER BY received_at DESC NULLS LAST,id DESC LIMIT 1`,[auth.storeId,x.line.variant_id]);
    const unitCost=lastCost.rowCount?Number(lastCost.rows[0].unit_cost_cents):
     x.row.cost_cents!==null?Number(x.row.cost_cents):null;
    await client.query(`INSERT INTO sale_lines(store_id,sale_id,variant_id,product_name,sku,color,size,
      quantity,unit_price_cents,line_total_cents,cost_unit_cents,discount_cents)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
     [auth.storeId,saleId,x.line.variant_id,x.row.name,x.row.sku,x.row.color,x.row.size,
      x.line.quantity,x.price,x.subtotal-lineDiscount,unitCost,lineDiscount]);
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
    const external=payment.method==='pix_manual'||payment.method==='card_external';
    await client.query(`INSERT INTO sale_payments(store_id,sale_id,method,amount_cents,external_reference,confirmed_manually)
     VALUES($1,$2,$3,$4,$5,$6)`,[auth.storeId,saleId,payment.method,payment.amount_cents,
      external?payment.external_reference!.trim():null,payment.method!=='store_credit']);
   }
   for(const part of installments){
    await client.query(`INSERT INTO retail_accounts
     (store_id,kind,customer_id,source_type,source_id,description,amount_cents,due_on,created_by)
     VALUES($1,'receivable',$2,'sale_credit',$3,$4,$5,$6,$7)`,
     [auth.storeId,body.customer_id,saleId,'Crediário da venda '+number,part.amount_cents,part.due_on,auth.userId]);
   }
   // Pontos só sobre dinheiro novo: crediário rende pontos na quitação, crédito/pontos não rendem pontos.
   const loyaltyBase=total-storeCredit-loyaltyCredit;
   if(loyaltyAllowed&&body.customer_id&&loyaltyPoints(loyaltyBase)>0){
    await client.query(`INSERT INTO retail_loyalty_events
     (store_id,customer_id,sale_id,points,kind,note,actor_id)
     VALUES($1,$2,$3,$4,'earn','Pontos da compra presencial',$5)`,
     [auth.storeId,body.customer_id,saleId,loyaltyPoints(loyaltyBase),auth.userId]);
   }
   const rate=await client.query<{rate_bps:number}>(`SELECT rate_bps FROM retail_commission_rules
     WHERE store_id=$1 AND seller_id=$2`,[auth.storeId,sellerId]);
   if(rate.rows[0]?.rate_bps>0){
    await client.query(`INSERT INTO retail_commission_entries
     (store_id,sale_id,seller_id,base_cents,rate_bps,amount_cents)
     VALUES($1,$2,$3,$4,$5,$6)`,
     [auth.storeId,saleId,sellerId,total,rate.rows[0].rate_bps,commissionCents(total,rate.rows[0].rate_bps)]);
   }
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
     VALUES($1,$2,'sales.confirm',$3,$4::jsonb)`,
    [auth.storeId,auth.userId,saleId,JSON.stringify({number,total,subtotal:subtotalCents,discount:discounts.discount,discount_reason:body.discount_reason,
     change,cash_session_id:body.cash_session_id,pickup_order_id:body.pickup_order_id,stock_hold_ids:body.stock_hold_ids})]);
   await client.query(`INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload)
     VALUES($1,'sales.sale.confirmed.v1',$2,1,$3::jsonb)`,
    [auth.storeId,saleId,JSON.stringify({sale_number:number,total_cents:total})]);
   return {id:saleId,sale_number:number,status:'confirmed',subtotal_cents:subtotalCents,discount_cents:discounts.discount,
    total_cents:total,tendered_cents:tendered,
    credit_due_cents:storeCredit,change_cents:change,created_at:created.rows[0].created_at,
    cash_session_id:body.cash_session_id};
  });
  return reply.code(201).send(out.result);
 });
 app.get<{Params:{id:string}}>('/v1/sales/:id',{
  schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',pattern:uid}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'sale.read'))return reply;
  return readSale(db,request.authContext!.storeId,request.params.id);
 });
 // Segunda via do cupom: localizar a venda pelo número impresso. O caixa só encontra as próprias vendas.
 app.get<{Params:{number:string}}>('/v1/sales/by-number/:number',{
  schema:{params:{type:'object',required:['number'],properties:{number:{type:'string',pattern:'^[0-9]{1,12}$'}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'sale.read'))return reply;
  const auth=request.authContext!;
  const found=await db.query<{id:string;sale_number:string;total_cents:string;created_at:Date;status:string;cashier_id:string}>(
   `SELECT id::text,sale_number::text,total_cents::text,created_at,status,cashier_id::text FROM sales
    WHERE store_id=$1 AND sale_number=$2`,[auth.storeId,request.params.number]);
  const row=found.rows[0];
  if(!row||(!auth.roles.includes('manager')&&row.cashier_id!==auth.userId))
   throw new DomainError(404,'SALE_NOT_FOUND','Venda não encontrada');
  return {id:row.id,sale_number:Number(row.sale_number),total_cents:Number(row.total_cents),created_at:row.created_at,status:row.status};
 });
 app.get<{Params:{id:string};Querystring:{cols?:number;gift?:boolean}}>('/v1/sales/:id/receipt',{
  schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',pattern:uid}}},
   querystring:{type:'object',additionalProperties:false,properties:{cols:{type:'integer',enum:[...RECEIPT_COLUMNS]},gift:{type:'boolean'}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'sale.read'))return reply;
  const storeId=request.authContext!.storeId;
  const sale=await readSale(db,storeId,request.params.id);
  const extra=await db.query<{subtotal_cents:string|null;discount_cents:string;discount_reason:string|null;customer:string|null;
   seller:string|null;store_name:string;legal_name:string|null;document:string|null;address:string|null;phone:string|null;
   receipt_footer:string|null;timezone:string}>(`SELECT s.subtotal_cents::text,s.discount_cents::text,s.discount_reason,
    c.name AS customer,coalesce(u.display_name,u.login) AS seller,st.name AS store_name,st.legal_name,st.document,st.address,
    st.phone,st.receipt_footer,st.timezone
   FROM sales s JOIN stores st ON st.id=s.store_id LEFT JOIN retail_customers c ON c.id=s.customer_id AND c.store_id=s.store_id
   LEFT JOIN users u ON u.id=s.seller_id WHERE s.store_id=$1 AND s.id=$2`,[storeId,sale.id]);
  const info=extra.rows[0];
  const installments=await db.query<{due_on:string;amount_cents:string}>(`SELECT due_on::text,amount_cents::text FROM retail_accounts
   WHERE store_id=$1 AND source_type='sale_credit' AND source_id=$2 AND cancelled_at IS NULL ORDER BY due_on`,[storeId,sale.id]);
  const lineDiscounts=await db.query<{discount_cents:string}>(`SELECT discount_cents::text FROM sale_lines
   WHERE sale_id=$1 AND store_id=$2 ORDER BY id`,[sale.id,storeId]);
  const money=(n:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
  const date=(iso:string)=>iso.split('-').reverse().join('/');
  const discount=Number(info.discount_cents);
  const cols=request.query.cols;
  if(request.query.gift){
   // Vale-troca: comprovante de presente sem preços nem pagamentos.
   const rows:ReceiptRow[]=[
    {kind:'center',text:info.store_name.toUpperCase()},
    ...(info.address?[{kind:'center',text:info.address} as const]:[]),
    ...(info.phone?[{kind:'center',text:'Tel.: '+info.phone} as const]:[]),
    {kind:'rule'},
    {kind:'center',text:'VALE-TROCA'},
    {kind:'center',text:'Sem valor. Apresente para trocar as peças.'},
    {kind:'rule'},
    {kind:'text',text:'Venda Nº '+sale.sale_number},
    {kind:'text',text:'Data: '+new Date(sale.created_at).toLocaleDateString('pt-BR',{timeZone:info.timezone||'America/Sao_Paulo'})},
    {kind:'rule'},
    ...sale.lines.map(l=>({kind:'pair',label:l.product_name+' ('+l.color+'/'+l.size+')',value:l.quantity+' un.'} as const)),
    ...(info.receipt_footer?[{kind:'rule'} as const,{kind:'center',text:info.receipt_footer} as const]:[]),
    {kind:'rule'},
    {kind:'center',text:'Código '+sale.id.slice(0,8).toUpperCase()},
   ];
   return reply.header('cache-control','private,no-store').type('text/plain; charset=utf-8').send(formatReceipt(rows,cols??42));
  }
  if(cols){
   // Cupom em colunas para bobina 58/80 mm ou A4 meia folha: valores alinhados à direita.
   const rows:ReceiptRow[]=[
    {kind:'center',text:info.store_name.toUpperCase()},
    ...(info.legal_name?[{kind:'center',text:info.legal_name} as const]:[]),
    ...(info.document?[{kind:'center',text:'CNPJ/CPF: '+info.document} as const]:[]),
    ...(info.address?[{kind:'center',text:info.address} as const]:[]),
    ...(info.phone?[{kind:'center',text:'Tel.: '+info.phone} as const]:[]),
    {kind:'rule'},
    {kind:'center',text:'COMPROVANTE NÃO FISCAL'},
    {kind:'center',text:'Não substitui documento fiscal quando exigido.'},
    {kind:'rule'},
    {kind:'text',text:'Venda Nº '+sale.sale_number},
    ...(sale.status==='returned'?[{kind:'text',text:'VENDA DEVOLVIDA'} as const]:sale.status==='partially_returned'?[{kind:'text',text:'VENDA COM DEVOLUÇÃO PARCIAL'} as const]:[]),
    {kind:'text',text:'Data: '+new Date(sale.created_at).toLocaleString('pt-BR',{timeZone:info.timezone||'America/Sao_Paulo'})},
    ...(info.customer?[{kind:'text',text:'Cliente: '+info.customer} as const]:[]),
    ...(info.seller?[{kind:'text',text:'Vendedor: '+info.seller} as const]:[]),
    {kind:'rule'},
    ...sale.lines.flatMap((l,i):ReceiptRow[]=>{
      const d=Number(lineDiscounts.rows[i]?.discount_cents??0);
      return [{kind:'text',text:l.product_name+' ('+l.color+'/'+l.size+')'},
        {kind:'pair',label:'  '+l.quantity+' × '+money(l.unit_price_cents),value:money(l.line_total_cents)},
        ...(d?[{kind:'pair',label:'  desconto',value:'-'+money(d)} as const]:[])];
    }),
    {kind:'rule'},
    ...(discount?[{kind:'pair',label:'SUBTOTAL',value:money(Number(info.subtotal_cents??sale.total_cents+discount))} as const,
      {kind:'pair',label:'DESCONTO'+(info.discount_reason?' ('+info.discount_reason+')':''),value:'-'+money(discount)} as const]:[]),
    {kind:'pair',label:'TOTAL',value:money(sale.total_cents)},
    ...sale.payments.map(p=>({kind:'pair',label:PAYMENT_LABELS[p.method]??p.method,value:money(p.amount_cents)} as const)),
    {kind:'pair',label:'TROCO',value:money(sale.change_cents)},
    ...(installments.rowCount?[{kind:'rule'} as const,{kind:'text',text:'PARCELAS DO CREDIÁRIO'} as const,...installments.rows.map((x,i)=>
      ({kind:'pair',label:(i+1)+'ª '+date(x.due_on),value:money(Number(x.amount_cents))} as const))]:[]),
    ...(info.receipt_footer?[{kind:'rule'} as const,{kind:'center',text:info.receipt_footer} as const]:[]),
    {kind:'rule'},
    {kind:'center',text:'Obrigado pela preferência!'},
    {kind:'center',text:'Código '+sale.id.slice(0,8).toUpperCase()},
   ];
   return reply.header('cache-control','private,no-store').type('text/plain; charset=utf-8').send(formatReceipt(rows,cols));
  }
  const body=[
    info.store_name.toUpperCase(),
    ...(info.legal_name?[info.legal_name]:[]),
    ...(info.document?['CNPJ/CPF: '+info.document]:[]),
    ...(info.address?[info.address]:[]),
    ...(info.phone?['Tel.: '+info.phone]:[]),
    'COMPROVANTE NÃO FISCAL','Não substitui documento fiscal quando exigido.',
    '--------------------------------',
    'Venda Nº '+sale.sale_number,
    ...(sale.status==='returned'?['VENDA DEVOLVIDA']:sale.status==='partially_returned'?['VENDA COM DEVOLUÇÃO PARCIAL']:[]),
    'Data: '+new Date(sale.created_at).toLocaleString('pt-BR',{timeZone:info.timezone||'America/Sao_Paulo'}),
    ...(info.customer?['Cliente: '+info.customer]:[]),
    ...(info.seller?['Vendedor: '+info.seller]:[]),
    '--------------------------------',
    ...sale.lines.flatMap((l,i)=>{
      const d=Number(lineDiscounts.rows[i]?.discount_cents??0);
      return [l.quantity+' × '+l.product_name+' ('+l.color+'/'+l.size+') '+money(l.line_total_cents),
        ...(d?['   desconto '+money(d)]:[])];
    }),
    '--------------------------------',
    ...(discount?['SUBTOTAL '+money(Number(info.subtotal_cents??sale.total_cents+discount)),
      'DESCONTO -'+money(discount)+(info.discount_reason?' ('+info.discount_reason+')':'')]:[]),
    'TOTAL '+money(sale.total_cents),
    ...sale.payments.map(p=>(PAYMENT_LABELS[p.method]??p.method)+' '+money(p.amount_cents)),
    'TROCO '+money(sale.change_cents),
    ...(installments.rowCount?['PARCELAS DO CREDIÁRIO',...installments.rows.map((x,i)=>
      (i+1)+'ª '+date(x.due_on)+' '+money(Number(x.amount_cents)))]:[]),
    ...(info.receipt_footer?['--------------------------------',info.receipt_footer]:[]),
    'ID: '+sale.id,
  ].join('\n');
  return reply.header('cache-control','private,no-store').type('text/plain; charset=utf-8').send(body);
 });
}
