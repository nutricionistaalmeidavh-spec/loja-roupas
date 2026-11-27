import type {FastifyInstance} from 'fastify';
import type {Pool,PoolClient} from 'pg';
import {requirePermission} from './auth.ts';
import type {AuthContext} from './auth.ts';
import {DomainError,requireIdempotencyKey,withIdempotentTransaction} from './transactions.ts';
import {commissionCents,lineRefundCents,loyaltyPoints} from './retail-rules.ts';
import {expectedCash} from './cash.ts';

type Q=Pick<PoolClient,'query'>;
export type RefundMethod='cash'|'pix_manual'|'card_external'|'store_credit'|'customer_credit';
export const REFUND_ORDER:readonly RefundMethod[]=['store_credit','customer_credit','card_external','pix_manual','cash'];
const uuid='^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$';

/** Quantidade já devolvida ou trocada de cada linha da venda, somando todos os caminhos. */
export const returnedQuantitySql=`(coalesce((SELECT sum(rl.quantity) FROM cash_return_lines rl
    JOIN cash_sale_returns r ON r.id=rl.return_id AND r.store_id=rl.store_id
    WHERE rl.store_id=l.store_id AND rl.sale_line_id=l.id AND r.sale_id=l.sale_id),0)
   +coalesce((SELECT sum(x.quantity) FROM retail_after_sale_lines x
    JOIN retail_after_sales a ON a.id=x.operation_id AND a.store_id=x.store_id
    WHERE x.store_id=l.store_id AND x.sale_line_id=l.id AND a.sale_id=l.sale_id),0))`;

export type SaleLineState={id:string;variant_id:string;product_name:string;sku:string;color:string;size:string;
 quantity:number;unit_price_cents:number;line_total_cents:number;discount_cents:number;returned_quantity:number};

export async function saleLines(db:Q,storeId:string,saleId:string,lock=false):Promise<SaleLineState[]>{
 const q=await db.query<Record<string,string>>(`SELECT l.id::text,l.variant_id::text,l.product_name,l.sku,l.color,l.size,
  l.quantity::text,l.unit_price_cents::text,l.line_total_cents::text,l.discount_cents::text,
  ${returnedQuantitySql}::text AS returned_quantity
  FROM sale_lines l WHERE l.store_id=$1 AND l.sale_id=$2 ORDER BY l.id ${lock?'FOR UPDATE OF l':''}`,[storeId,saleId]);
 return q.rows.map(r=>({id:r.id,variant_id:r.variant_id,product_name:r.product_name,sku:r.sku,color:r.color,size:r.size,
  quantity:Number(r.quantity),unit_price_cents:Number(r.unit_price_cents),line_total_cents:Number(r.line_total_cents),
  discount_cents:Number(r.discount_cents),returned_quantity:Number(r.returned_quantity)}));
}

/** Quanto ainda pode ser devolvido em cada meio de pagamento da venda. */
export async function refundableByMethod(db:Q,storeId:string,saleId:string):Promise<Record<RefundMethod,number>>{
 const q=await db.query<{method:string;paid:string;refunded:string}>(`
  WITH paid AS (
   SELECT CASE WHEN method='exchange_credit' THEN 'customer_credit' ELSE method END AS method,sum(amount_cents) AS cents
   FROM sale_payments WHERE store_id=$1 AND sale_id=$2 GROUP BY 1
   UNION ALL SELECT 'cash',-change_cents FROM sales WHERE store_id=$1 AND id=$2
  ), refunded AS (
   SELECT 'cash' AS method,amount_cents AS cents FROM cash_sale_returns WHERE store_id=$1 AND sale_id=$2
   UNION ALL SELECT payment_method,amount_cents FROM retail_after_sales
    WHERE store_id=$1 AND sale_id=$2 AND kind='external_refund'
   UNION ALL SELECT p.method,p.amount_cents FROM retail_refund_parts p
    JOIN retail_after_sales a ON a.id=p.operation_id AND a.store_id=p.store_id
    WHERE a.store_id=$1 AND a.sale_id=$2
  )
  SELECT m.method,coalesce((SELECT sum(cents) FROM paid WHERE paid.method=m.method),0)::text AS paid,
   coalesce((SELECT sum(cents) FROM refunded WHERE refunded.method=m.method),0)::text AS refunded
  FROM unnest($3::text[]) AS m(method)`,[storeId,saleId,[...REFUND_ORDER]]);
 const out={} as Record<RefundMethod,number>;
 for(const r of q.rows)out[r.method as RefundMethod]=Math.max(0,Number(r.paid)-Number(r.refunded));
 return out;
}

/** Sugestão de reembolso: primeiro abate o crediário, depois crédito, cartão, Pix e por fim dinheiro. */
export function suggestRefund(amount:number,refundable:Record<RefundMethod,number>){
 let rest=amount;const parts:{method:RefundMethod;amount_cents:number}[]=[];
 for(const method of REFUND_ORDER){
  const take=Math.min(rest,refundable[method]??0);
  if(take>0){parts.push({method,amount_cents:take});rest-=take;}
 }
 if(rest>0)throw new DomainError(409,'REFUND_EXCEEDS_PAYMENTS','Valor da devolução excede o que foi pago na venda');
 return parts;
}

/** Devolve a peça ao estoque vendável ou à quarentena (avariados). */
export async function returnToStock(db:Q,auth:AuthContext,variantId:string,qty:number,condition:'resellable'|'quarantine',
 sourceType:string,sourceId:string){
 if(condition==='resellable'){
  const b=await db.query<{revision:string}>(`UPDATE stock_balances SET on_hand=on_hand+$3,revision=revision+1
   WHERE store_id=$1 AND variant_id=$2 RETURNING revision::text`,[auth.storeId,variantId,qty]);
  if(!b.rowCount)throw new DomainError(409,'STOCK_MISSING','Saldo inexistente para peça devolvida');
  await db.query(`INSERT INTO stock_movements(store_id,variant_id,source_type,source_id,movement_kind,qty_delta)
   VALUES($1,$2,$3,$4,'return',$5)`,[auth.storeId,variantId,sourceType,sourceId,qty]);
  await db.query(`INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload)
   VALUES($1,'inventory.stock.changed.v1',$2,$3,$4::jsonb)`,
   [auth.storeId,variantId,Number(b.rows[0].revision),JSON.stringify({source_type:sourceType,source_id:sourceId})]);
  return;
 }
 await db.query(`INSERT INTO stock_balances(store_id,variant_id,on_hand,reserved,quarantined) VALUES($1,$2,0,0,$3)
  ON CONFLICT(store_id,variant_id) DO UPDATE SET quarantined=stock_balances.quarantined+EXCLUDED.quarantined`,
  [auth.storeId,variantId,qty]);
 await db.query(`INSERT INTO stock_quarantine_moves(store_id,variant_id,qty_delta,kind,source_id,actor_id)
  VALUES($1,$2,$3,'return',$4,$5)`,[auth.storeId,variantId,qty,sourceId,auth.userId]);
 await db.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
  VALUES($1,$2,'inventory.return.quarantine',$3,$4::jsonb)`,
  [auth.storeId,auth.userId,variantId,JSON.stringify({source_type:sourceType,source_id:sourceId,quantity:qty})]);
}

export async function updateSaleReturnStatus(db:Q,storeId:string,saleId:string){
 const lines=await saleLines(db,storeId,saleId);
 const total=lines.reduce((n,l)=>n+l.quantity,0),returned=lines.reduce((n,l)=>n+l.returned_quantity,0);
 const status=returned===0?'confirmed':returned>=total?'returned':'partially_returned';
 await db.query('UPDATE sales SET status=$3 WHERE store_id=$1 AND id=$2',[storeId,saleId,status]);
 return status;
}

export async function reverseLoyaltyAndCommission(db:Q,auth:AuthContext,saleId:string,customerId:string|null,
 operationId:string,amount:number,loyaltyAmount=amount){
 if(customerId&&loyaltyPoints(loyaltyAmount)>0){
  const earned=await db.query(`SELECT 1 FROM retail_loyalty_events WHERE store_id=$1 AND sale_id=$2 AND kind='earn'`,[auth.storeId,saleId]);
  if(earned.rowCount)await db.query(`INSERT INTO retail_loyalty_events(store_id,customer_id,sale_id,points,kind,note,actor_id)
   VALUES($1,$2,$3,$4,'reverse','Estorno de pontos por devolução',$5)`,[auth.storeId,customerId,saleId,-loyaltyPoints(loyaltyAmount),auth.userId]);
 }
 const c=await db.query<{seller_id:string;rate_bps:number}>(`SELECT seller_id::text,rate_bps FROM retail_commission_entries
  WHERE store_id=$1 AND sale_id=$2 FOR UPDATE`,[auth.storeId,saleId]);
 if(c.rowCount)await db.query(`INSERT INTO retail_commission_reversals(store_id,sale_id,operation_id,seller_id,amount_cents)
  VALUES($1,$2,$3,$4,$5)`,[auth.storeId,saleId,operationId,c.rows[0].seller_id,commissionCents(amount,c.rows[0].rate_bps)]);
}

/** Abate o crediário da venda, das parcelas mais distantes para as mais próximas. Retorna o que já tinha sido pago. */
async function reduceReceivables(db:Q,storeId:string,saleId:string,amount:number){
 const q=await db.query<{id:string;amount_cents:string;settled_cents:string}>(`SELECT id::text,amount_cents::text,settled_cents::text
  FROM retail_accounts WHERE store_id=$1 AND kind='receivable' AND source_type='sale_credit' AND source_id=$2
   AND cancelled_at IS NULL ORDER BY due_on DESC,id DESC FOR UPDATE`,[storeId,saleId]);
 let rest=amount;
 for(const a of q.rows){
  if(!rest)break;
  const open=Number(a.amount_cents)-Number(a.settled_cents);
  const take=Math.min(open,rest);
  if(take<=0)continue;
  if(take===Number(a.amount_cents))await db.query('UPDATE retail_accounts SET cancelled_at=now() WHERE store_id=$1 AND id=$2',[storeId,a.id]);
  else await db.query('UPDATE retail_accounts SET amount_cents=amount_cents-$3 WHERE store_id=$1 AND id=$2',[storeId,a.id,take]);
  rest-=take;
 }
 return rest;
}

type Item={sale_line_id:string;quantity:number;condition:'resellable'|'quarantine'};
type Part={method:RefundMethod;amount_cents:number;external_reference?:string};
type RefundBody={sale_number:number;reason:string;cash_session_id?:string;items:Item[];parts:Part[]};

async function findSale(db:Q,storeId:string,number:number,lock:boolean){
 const q=await db.query<{id:string;status:string;customer_id:string|null}>(`SELECT id::text,status,customer_id::text
  FROM sales WHERE store_id=$1 AND sale_number=$2 ${lock?'FOR UPDATE':''}`,[storeId,number]);
 if(!q.rowCount)throw new DomainError(404,'SALE_NOT_FOUND','Venda não encontrada');
 return q.rows[0];
}
async function amountFor(db:Q,storeId:string,saleId:string,items:readonly Item[],lock:boolean){
 if(new Set(items.map(i=>i.sale_line_id)).size!==items.length)
  throw new DomainError(422,'DUPLICATE_RETURN_LINE','A mesma peça não pode aparecer duas vezes na devolução');
 const lines=new Map((await saleLines(db,storeId,saleId,lock)).map(l=>[l.id,l]));
 let amount=0;const priced=[];
 for(const item of items){
  const line=lines.get(item.sale_line_id);
  if(!line||item.quantity>line.quantity-line.returned_quantity)
   throw new DomainError(409,'RETURN_QUANTITY','Peça indisponível ou quantidade já devolvida');
  const value=lineRefundCents(line.line_total_cents,line.quantity,line.returned_quantity,item.quantity);
  amount+=value;priced.push({item,line,value});
 }
 return {amount,priced};
}

const itemsSchema={type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,
 required:['sale_line_id','quantity','condition'],properties:{sale_line_id:{type:'string',pattern:uuid},
  quantity:{type:'integer',minimum:1,maximum:10000},condition:{type:'string',enum:['resellable','quarantine']}}}} as const;

export function registerRefunds(app:FastifyInstance,db:Pool){
 app.post<{Body:{sale_number:number;items:Item[]}}>('/v1/management/after-sales/refund/preview',{
  schema:{body:{type:'object',additionalProperties:false,required:['sale_number','items'],properties:{
   sale_number:{type:'integer',minimum:1},items:itemsSchema}}}
 },async(req,reply)=>{
  if(requirePermission(req,reply,'sale.return'))return reply;
  const store=req.authContext!.storeId,sale=await findSale(db,store,req.body.sale_number,false);
  if(!['confirmed','partially_returned'].includes(sale.status))
   throw new DomainError(409,'RETURN_INELIGIBLE','Esta venda não possui peças disponíveis para devolução');
  const {amount}=await amountFor(db,store,sale.id,req.body.items,false);
  const refundable=await refundableByMethod(db,store,sale.id);
  return {amount_cents:amount,refundable,suggested:suggestRefund(amount,refundable)};
 });

 app.post<{Body:RefundBody}>('/v1/management/after-sales/refund',{
  schema:{body:{type:'object',additionalProperties:false,required:['sale_number','reason','items','parts'],properties:{
   sale_number:{type:'integer',minimum:1},reason:{type:'string',minLength:8,maxLength:250},
   cash_session_id:{type:'string',pattern:uuid},items:itemsSchema,
   parts:{type:'array',minItems:1,maxItems:5,items:{type:'object',additionalProperties:false,required:['method','amount_cents'],
    properties:{method:{type:'string',enum:[...REFUND_ORDER]},amount_cents:{type:'integer',minimum:1},
     external_reference:{type:'string',minLength:4,maxLength:128}}}}}}}
 },async(req,reply)=>{
  if(requirePermission(req,reply,'sale.return'))return reply;
  const auth=req.authContext!,b=req.body,reason=b.reason.trim();
  if(reason.length<8)throw new DomainError(422,'RETURN_REASON','Justifique a devolução com pelo menos 8 caracteres');
  if(new Set(b.parts.map(p=>p.method)).size!==b.parts.length)
   throw new DomainError(422,'REFUND_PARTS','Informe cada forma de reembolso uma única vez');
  for(const p of b.parts){
   const external=p.method==='pix_manual'||p.method==='card_external';
   if(external!==Boolean(p.external_reference?.trim()))
    throw new DomainError(422,'REFUND_REFERENCE','Estorno de Pix/cartão exige comprovante; os demais meios não aceitam referência');
  }
  const cashPart=b.parts.find(p=>p.method==='cash');
  if(cashPart&&!b.cash_session_id)throw new DomainError(422,'CASH_REQUIRED','Abra o caixa para devolver dinheiro');
  const out=await withIdempotentTransaction(db,auth,'retail.refund',requireIdempotencyKey(req.headers['idempotency-key']),b,async c=>{
   const sale=await findSale(c,auth.storeId,b.sale_number,true);
   if(!['confirmed','partially_returned'].includes(sale.status))
    throw new DomainError(409,'RETURN_INELIGIBLE','Esta venda não possui peças disponíveis para devolução');
   const {amount,priced}=await amountFor(c,auth.storeId,sale.id,b.items,true);
   const parts=b.parts.reduce((n,p)=>n+p.amount_cents,0);
   if(parts!==amount)throw new DomainError(422,'REFUND_TOTAL','A soma do reembolso deve ser igual ao valor das peças ('+amount+' centavos)');
   const refundable=await refundableByMethod(c,auth.storeId,sale.id);
   for(const p of b.parts)if(p.amount_cents>(refundable[p.method]??0))
    throw new DomainError(409,'REFUND_PAYMENT_MISMATCH','Reembolso excede o valor pago neste meio');
   if(cashPart){
    const cash=await c.query<{opening_cents:string;opened_by:string;closed_at:Date|null}>(`SELECT opening_cents::text,opened_by::text,closed_at
     FROM cash_sessions WHERE store_id=$1 AND id=$2 FOR UPDATE`,[auth.storeId,b.cash_session_id]);
    if(!cash.rowCount||cash.rows[0].closed_at)throw new DomainError(409,'CASH_CLOSED','Abra o caixa antes de devolver dinheiro');
    if(!auth.roles.includes('manager')&&cash.rows[0].opened_by!==auth.userId)
     throw new DomainError(403,'CASH_OWNER','Este caixa pertence a outro operador');
    const available=await expectedCash(c,auth.storeId,b.cash_session_id!,Number(cash.rows[0].opening_cents));
    if(cashPart.amount_cents>available)throw new DomainError(409,'INSUFFICIENT_CASH','Dinheiro insuficiente no caixa para a devolução');
   }
   if((b.parts.some(p=>p.method==='store_credit'||p.method==='customer_credit'))&&!sale.customer_id)
    throw new DomainError(422,'CUSTOMER_REQUIRED','Venda sem cliente não aceita crédito');
   const op=await c.query<{id:string}>(`INSERT INTO retail_after_sales(store_id,sale_id,kind,actor_id,amount_cents,reason,cash_session_id)
    VALUES($1,$2,'refund',$3,$4,$5,$6) RETURNING id::text`,[auth.storeId,sale.id,auth.userId,amount,reason,b.cash_session_id??null]);
   const id=op.rows[0].id;
   for(const x of priced){
    await c.query(`INSERT INTO retail_after_sale_lines(store_id,operation_id,sale_line_id,quantity,disposition,unit_amount_cents)
     VALUES($1,$2,$3,$4,$5,$6)`,[auth.storeId,id,x.line.id,x.item.quantity,x.item.condition,Math.floor(x.value/x.item.quantity)]);
    await returnToStock(c,auth,x.line.variant_id,x.item.quantity,x.item.condition,'retail_after_sale',id);
   }
   let creditBack=0;
   for(const p of b.parts){
    await c.query(`INSERT INTO retail_refund_parts(store_id,operation_id,method,amount_cents,external_reference,cash_session_id)
     VALUES($1,$2,$3,$4,$5,$6)`,[auth.storeId,id,p.method,p.amount_cents,p.external_reference?.trim()??null,
     p.method==='cash'?b.cash_session_id:null]);
    if(p.method==='cash')await c.query(`INSERT INTO cash_movements(store_id,cash_session_id,actor_id,kind,amount_cents,reason)
     VALUES($1,$2,$3,'refund',$4,$5)`,[auth.storeId,b.cash_session_id,auth.userId,p.amount_cents,reason]);
    if(p.method==='store_credit')creditBack+=await reduceReceivables(c,auth.storeId,sale.id,p.amount_cents);
    if(p.method==='customer_credit')creditBack+=p.amount_cents;
   }
   // Crédito devolvido ou parcelas já quitadas viram saldo de crédito do cliente.
   if(creditBack>0)await c.query(`INSERT INTO retail_customer_credits(store_id,customer_id,source_type,source_id,amount_cents)
    VALUES($1,$2,'refund',$3,$4)`,[auth.storeId,sale.customer_id,id,creditBack]);
   const newMoney=b.parts.filter(p=>p.method!=='store_credit'&&p.method!=='customer_credit').reduce((n,p)=>n+p.amount_cents,0);
   await reverseLoyaltyAndCommission(c,auth,sale.id,sale.customer_id,id,amount,newMoney);
   const status=await updateSaleReturnStatus(c,auth.storeId,sale.id);
   await c.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
    VALUES($1,$2,'sales.refund',$3,$4::jsonb)`,[auth.storeId,auth.userId,id,
    JSON.stringify({sale_id:sale.id,amount_cents:amount,parts:b.parts,items:b.items,customer_credit_cents:creditBack,status})]);
   return {id,sale_id:sale.id,refunded_cents:amount,parts:b.parts,customer_credit_cents:creditBack,status};
  });
  return reply.code(out.replayed?200:201).send({...out.result,replayed:out.replayed});
 });

 // Peças avariadas: liberar para venda depois do conserto, ou baixar como perda.
 app.get('/v1/stock/quarantine',async(req,reply)=>{
  if(requirePermission(req,reply,'stock.read'))return reply;
  const q=await db.query(`SELECT b.variant_id::text,p.name,v.sku,v.color,v.size,b.quarantined::text
   FROM stock_balances b JOIN product_variants v ON v.id=b.variant_id AND v.store_id=b.store_id
   JOIN products p ON p.id=v.product_id AND p.store_id=v.store_id
   WHERE b.store_id=$1 AND b.quarantined>0 ORDER BY p.name,v.sku LIMIT 500`,[req.authContext!.storeId]);
  return {items:q.rows};
 });
 app.post<{Body:{variant_id:string;quantity:number;action:'release'|'discard';reason:string}}>('/v1/stock/quarantine/resolve',{
  schema:{body:{type:'object',additionalProperties:false,required:['variant_id','quantity','action','reason'],properties:{
   variant_id:{type:'string',pattern:uuid},quantity:{type:'integer',minimum:1,maximum:100000},
   action:{type:'string',enum:['release','discard']},reason:{type:'string',minLength:8,maxLength:250}}}}
 },async(req,reply)=>{
  if(requirePermission(req,reply,'stock.adjust'))return reply;
  const auth=req.authContext!,b=req.body;
  const out=await withIdempotentTransaction(db,auth,'stock.quarantine',requireIdempotencyKey(req.headers['idempotency-key']),b,async c=>{
   const q=await c.query<{revision:string;quarantined:string}>(`UPDATE stock_balances SET quarantined=quarantined-$3,
     on_hand=on_hand+CASE WHEN $4='release' THEN $3 ELSE 0 END,revision=revision+1
    WHERE store_id=$1 AND variant_id=$2 AND quarantined>=$3 RETURNING revision::text,quarantined::text`,
    [auth.storeId,b.variant_id,b.quantity,b.action]);
   if(!q.rowCount)throw new DomainError(409,'QUARANTINE_LOW','Quantidade maior que as peças em avaria');
   const move=await c.query<{id:string}>(`INSERT INTO stock_quarantine_moves(store_id,variant_id,qty_delta,kind,reason,actor_id)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text`,[auth.storeId,b.variant_id,-b.quantity,b.action,b.reason.trim(),auth.userId]);
   if(b.action==='release'){
    await c.query(`INSERT INTO stock_movements(store_id,variant_id,source_type,source_id,movement_kind,qty_delta)
     VALUES($1,$2,'quarantine_release',$3,'adjustment',$4)`,[auth.storeId,b.variant_id,move.rows[0].id,b.quantity]);
    await c.query(`INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload)
     VALUES($1,'inventory.stock.changed.v1',$2,$3,$4::jsonb)`,[auth.storeId,b.variant_id,Number(q.rows[0].revision),
     JSON.stringify({quarantine_move_id:move.rows[0].id})]);
   }
   await c.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
    VALUES($1,$2,'inventory.quarantine.'||$3,$4,$5::jsonb)`,[auth.storeId,auth.userId,b.action,b.variant_id,JSON.stringify(b)]);
   return {variant_id:b.variant_id,action:b.action,quarantined:Number(q.rows[0].quarantined)};
  });
  return out.result;
 });
}
