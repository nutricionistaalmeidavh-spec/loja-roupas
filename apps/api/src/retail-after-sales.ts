import type {FastifyInstance} from 'fastify';
import type {Pool,PoolClient} from 'pg';
import {requirePermission} from './auth.ts';
import type {AuthContext} from './auth.ts';
import {DomainError,requireIdempotencyKey,withIdempotentTransaction} from './transactions.ts';
import {exchangeBalance,commissionCents,loyaltyPoints} from './retail-rules.ts';
import {expectedCash} from './cash.ts';
const uuid='^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$';
type ReturnBody={sale_number:number;sale_line_id:string;quantity:number;condition:'resellable'|'quarantine';
 reason:string;method:'pix_manual'|'card_external';external_reference:string;confirmed:boolean};
type ExchangeBody={sale_number:number;sale_line_id:string;quantity:number;condition:'resellable'|'quarantine';
 replacement_variant_id:string;replacement_quantity:number;cash_session_id:string;reason:string;
 customer_id?:string;payment?:{method:'cash'|'pix_manual'|'card_external';external_reference?:string;confirmed:boolean}};
const oldLine=async(c:PoolClient,store:string,sale:number,lineId:string)=>{
 const q=await c.query<{sale_id:string;status:string;id:string;quantity:string;unit_price_cents:string;
  variant_id:string;customer_id:string|null;seller_id:string|null}>(`SELECT s.id::text AS sale_id,s.status,l.id::text,l.quantity::text,
   l.unit_price_cents::text,l.variant_id::text,s.customer_id::text,s.seller_id::text
   FROM sales s JOIN sale_lines l ON l.sale_id=s.id AND l.store_id=s.store_id
   WHERE s.store_id=$1 AND s.sale_number=$2 AND l.id=$3 FOR UPDATE OF s,l`,[store,sale,lineId]);
 if(!q.rowCount)throw new DomainError(404,'RETURN_SALE_NOT_FOUND','Venda ou peça não encontrada');
 const line=q.rows[0];
 if(!['confirmed','partially_returned'].includes(line.status))
  throw new DomainError(409,'RETURN_CLOSED','Venda não elegível a trocas/devoluções');
 const used=await c.query<{qty:string}>(`SELECT (
    (SELECT coalesce(sum(cl.quantity),0) FROM cash_return_lines cl
     JOIN cash_sale_returns r ON r.id=cl.return_id AND r.store_id=cl.store_id
     WHERE cl.store_id=$1 AND cl.sale_line_id=$2 AND r.sale_id=$3)
    +(SELECT coalesce(sum(x.quantity),0) FROM retail_after_sale_lines x
     JOIN retail_after_sales r ON r.id=x.operation_id AND r.store_id=x.store_id
     WHERE x.store_id=$1 AND x.sale_line_id=$2 AND r.sale_id=$3)
   )::text AS qty`,[store,lineId,line.sale_id]);
 return {line,remaining:Number(line.quantity)-Number(used.rows[0].qty)};
};
async function finalizeOldSale(c:PoolClient,store:string,saleId:string){
 const q=await c.query<{total:string;returned:string}>(`SELECT
  (SELECT coalesce(sum(quantity),0)::text FROM sale_lines WHERE store_id=$1 AND sale_id=$2) AS total,
  ((SELECT coalesce(sum(cl.quantity),0) FROM cash_return_lines cl
    JOIN cash_sale_returns cr ON cr.id=cl.return_id AND cr.store_id=cl.store_id
    WHERE cr.store_id=$1 AND cr.sale_id=$2)
   +(SELECT coalesce(sum(rl.quantity),0) FROM retail_after_sale_lines rl
    JOIN retail_after_sales r ON r.id=rl.operation_id AND r.store_id=rl.store_id
    WHERE r.store_id=$1 AND r.sale_id=$2))::text AS returned`,[store,saleId]);
 const returned=Number(q.rows[0].returned),total=Number(q.rows[0].total);
 await c.query(`UPDATE sales SET status=$3 WHERE store_id=$1 AND id=$2`,
  [store,saleId,returned===total?'returned':'partially_returned']);
 return returned===total?'returned':'partially_returned';
}
async function applyReturn(c:PoolClient,auth:AuthContext,operationId:string,oldVariant:string,qty:number,condition:string){
 if(condition!=='resellable')return;
 const b=await c.query<{revision:string}>(`UPDATE stock_balances
  SET on_hand=on_hand+$3,revision=revision+1 WHERE store_id=$1 AND variant_id=$2
  RETURNING revision::text`,[auth.storeId,oldVariant,qty]);
 if(!b.rowCount)throw new DomainError(409,'STOCK_MISSING','Saldo inexistente para peça devolvida');
 await c.query(`INSERT INTO stock_movements(store_id,variant_id,source_type,source_id,movement_kind,qty_delta)
  VALUES($1,$2,'retail_after_sale',$3,'return',$4)`,[auth.storeId,oldVariant,operationId,qty]);
 await c.query(`INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload)
  VALUES($1,'inventory.stock.changed.v1',$2,$3,$4::jsonb)`,
  [auth.storeId,oldVariant,Number(b.rows[0].revision),JSON.stringify({operation_id:operationId})]);
}
async function reverseCommission(c:PoolClient,auth:AuthContext,saleId:string,operationId:string,amount:number){
 const row=await c.query<{seller_id:string;rate_bps:number}>(`SELECT seller_id::text,rate_bps
  FROM retail_commission_entries WHERE store_id=$1 AND sale_id=$2 FOR UPDATE`,[auth.storeId,saleId]);
 if(row.rowCount){
  await c.query(`INSERT INTO retail_commission_reversals(store_id,sale_id,operation_id,seller_id,amount_cents)
   VALUES($1,$2,$3,$4,$5)`,
   [auth.storeId,saleId,operationId,row.rows[0].seller_id,commissionCents(amount,row.rows[0].rate_bps)]);
 }
}

async function reverseLoyalty(c:PoolClient,auth:AuthContext,originalSaleId:string,customerId:string|null,amount:number){
 if(!customerId||!loyaltyPoints(amount))return;
 const earned=await c.query(`SELECT 1 FROM retail_loyalty_events WHERE store_id=$1 AND sale_id=$2 AND kind='earn'`,
  [auth.storeId,originalSaleId]);
 if(!earned.rowCount)return;
 await c.query(`INSERT INTO retail_loyalty_events
  (store_id,customer_id,sale_id,points,kind,note,actor_id)
  VALUES($1,$2,$3,$4,'reverse','Estorno de pontos por troca ou devolução',$5)`,
  [auth.storeId,customerId,originalSaleId,-loyaltyPoints(amount),auth.userId]);
}
const lineProps={sale_number:{type:'integer',minimum:1},sale_line_id:{type:'string',pattern:uuid},
 quantity:{type:'integer',minimum:1,maximum:10000},condition:{type:'string',enum:['resellable','quarantine']},
 reason:{type:'string',minLength:8,maxLength:250}};
export function registerRetailAfterSales(app:FastifyInstance,db:Pool){
 app.post<{Body:ReturnBody}>('/v1/management/after-sales/external-refund',{
  schema:{body:{type:'object',additionalProperties:false,
   required:['sale_number','sale_line_id','quantity','condition','reason','method','external_reference','confirmed'],
   properties:{...lineProps,method:{type:'string',enum:['pix_manual','card_external']},
    external_reference:{type:'string',minLength:6,maxLength:128},confirmed:{type:'boolean'}}}}
 },async(req,reply)=>{
  if(requirePermission(req,reply,'sale.return'))return reply;
  const auth=req.authContext!,b=req.body;
  if(!b.confirmed)throw new DomainError(422,'REFUND_NOT_CONFIRMED','Confirme o estorno no banco ou na maquininha');
  const out=await withIdempotentTransaction(db,auth,'retail.external.refund',
   requireIdempotencyKey(req.headers['idempotency-key']),b,async c=>{
    const {line,remaining}=await oldLine(c,auth.storeId,b.sale_number,b.sale_line_id);
    if(b.quantity>remaining)throw new DomainError(409,'RETURN_QUANTITY','Quantidade já devolvida ou indisponível');
    const amount=Number(line.unit_price_cents)*b.quantity;
    if(!Number.isSafeInteger(amount)||amount<=0)throw new DomainError(422,'REFUND_AMOUNT','Valor de estorno inválido');
    const paid=await c.query<{paid:string}>(`SELECT coalesce(sum(amount_cents),0)::text AS paid
     FROM sale_payments WHERE store_id=$1 AND sale_id=$2 AND method=$3`,
     [auth.storeId,line.sale_id,b.method]);
    const refunded=await c.query<{refunds:string}>(`SELECT coalesce(sum(amount_cents),0)::text AS refunds
     FROM retail_after_sales WHERE store_id=$1 AND sale_id=$2 AND kind='external_refund' AND payment_method=$3`,
     [auth.storeId,line.sale_id,b.method]);
    if(Number(paid.rows[0].paid)-Number(refunded.rows[0].refunds)<amount)
     throw new DomainError(409,'REFUND_PAYMENT_MISMATCH','Valor do estorno excede os pagamentos deste meio');
    const op=await c.query<{id:string}>(`INSERT INTO retail_after_sales
     (store_id,sale_id,kind,actor_id,amount_cents,payment_method,external_reference,reason)
     VALUES($1,$2,'external_refund',$3,$4,$5,$6,$7) RETURNING id::text`,
     [auth.storeId,line.sale_id,auth.userId,amount,b.method,b.external_reference.trim(),b.reason.trim()]);
    const id=op.rows[0].id;
    await c.query(`INSERT INTO retail_after_sale_lines
     (store_id,operation_id,sale_line_id,quantity,disposition,unit_amount_cents)
     VALUES($1,$2,$3,$4,$5,$6)`,[auth.storeId,id,b.sale_line_id,b.quantity,b.condition,line.unit_price_cents]);
    await applyReturn(c,auth,id,line.variant_id,b.quantity,b.condition);
    await reverseLoyalty(c,auth,line.sale_id,line.customer_id,amount);
    await reverseCommission(c,auth,line.sale_id,id,amount);
    const status=await finalizeOldSale(c,auth.storeId,line.sale_id);
    await c.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
     VALUES($1,$2,'sales.external_refund',$3,$4::jsonb)`,
     [auth.storeId,auth.userId,id,JSON.stringify({sale_id:line.sale_id,method:b.method,reference:b.external_reference,amount_cents:amount,status})]);
    return {id,refunded_cents:amount,status,method:b.method};
   });
  return reply.code(out.replayed?200:201).send({...out.result,replayed:out.replayed});
 });
 app.post<{Body:ExchangeBody}>('/v1/management/after-sales/exchange',{
  schema:{body:{type:'object',additionalProperties:false,
   required:['sale_number','sale_line_id','quantity','condition','replacement_variant_id','replacement_quantity','cash_session_id','reason'],
   properties:{...lineProps,replacement_variant_id:{type:'string',pattern:uuid},
    replacement_quantity:{type:'integer',minimum:1,maximum:10000},cash_session_id:{type:'string',pattern:uuid},
    customer_id:{type:'string',pattern:uuid},payment:{type:'object',additionalProperties:false,
     required:['method','confirmed'],properties:{method:{type:'string',enum:['cash','pix_manual','card_external']},
      confirmed:{type:'boolean'},external_reference:{type:'string',minLength:6,maxLength:128}}}}}}
 },async(req,reply)=>{
  if(requirePermission(req,reply,'sale.return'))return reply;
  const auth=req.authContext!,b=req.body;
  const out=await withIdempotentTransaction(db,auth,'retail.exchange',
   requireIdempotencyKey(req.headers['idempotency-key']),b,async c=>{
    const cash=await c.query<{opened_by:string;closed_at:Date|null}>(`SELECT opened_by::text,closed_at
     FROM cash_sessions WHERE store_id=$1 AND id=$2 FOR UPDATE`,[auth.storeId,b.cash_session_id]);
    if(!cash.rowCount||cash.rows[0].closed_at)throw new DomainError(409,'CASH_CLOSED','Caixa não aberto para troca');
    const {line,remaining}=await oldLine(c,auth.storeId,b.sale_number,b.sale_line_id);
    if(b.quantity>remaining)throw new DomainError(409,'RETURN_QUANTITY','Quantidade antiga indisponível para troca');
    if(b.replacement_variant_id===line.variant_id)
     throw new DomainError(422,'SAME_VARIANT','Selecione variante de substituição diferente');
    const replacement=await c.query<{name:string;sku:string;color:string;size:string;price_cents:string}>(`
     SELECT p.name,v.sku,v.color,v.size,v.price_cents::text FROM product_variants v
     JOIN products p ON p.id=v.product_id AND p.store_id=v.store_id
     WHERE v.store_id=$1 AND v.id=$2 FOR SHARE OF v`,[auth.storeId,b.replacement_variant_id]);
    if(!replacement.rowCount)throw new DomainError(404,'REPLACEMENT_NOT_FOUND','Peça de reposição inexistente');
    const current=await c.query<{on_hand:string;reserved:string}>(`SELECT on_hand::text,reserved::text
     FROM stock_balances WHERE store_id=$1 AND variant_id=$2 FOR UPDATE`,[auth.storeId,b.replacement_variant_id]);
    if(!current.rowCount||Number(current.rows[0].on_hand)-Number(current.rows[0].reserved)<b.replacement_quantity)
     throw new DomainError(409,'REPLACEMENT_STOCK','Peça de troca sem estoque disponível');
    const returnedValue=Number(line.unit_price_cents)*b.quantity;
    const outgoingValue=Number(replacement.rows[0].price_cents)*b.replacement_quantity;
    if(!Number.isSafeInteger(returnedValue)||!Number.isSafeInteger(outgoingValue)||outgoingValue<=0)
     throw new DomainError(422,'EXCHANGE_AMOUNT','Valores da troca inválidos');
    const balance=exchangeBalance(returnedValue,outgoingValue);
    if(balance.extra_due_cents>0){
     if(!b.payment?.confirmed)throw new DomainError(422,'EXCHANGE_PAYMENT','Confirme o pagamento da diferença');
     const external=b.payment.method!=='cash';
     if(external&&(!b.payment.external_reference||b.payment.external_reference.trim().length<6)||
       !external&&b.payment.external_reference)
      throw new DomainError(422,'EXCHANGE_REFERENCE','Comprovante externo inválido');
    }else if(b.payment)throw new DomainError(422,'UNEXPECTED_PAYMENT','A troca não exige pagamento de diferença');
    const customerId=b.customer_id||line.customer_id;
    if(balance.credit_cents>0&&!customerId)
     throw new DomainError(422,'CUSTOMER_REQUIRED','Identifique cliente para emitir o crédito da troca');
    if(customerId){
     const verified=await c.query(`SELECT 1 FROM retail_customers WHERE store_id=$1 AND id=$2
      AND anonymized_at IS NULL FOR UPDATE`,[auth.storeId,customerId]);
     if(!verified.rowCount)throw new DomainError(404,'CUSTOMER_NOT_FOUND','Cliente inexistente');
    }
    const saleCounter=await c.query<{last_number:string}>(`INSERT INTO store_counters(store_id,counter_name,last_number)
      VALUES($1,'sale',1) ON CONFLICT(store_id,counter_name)
      DO UPDATE SET last_number=store_counters.last_number+1 RETURNING last_number::text`,[auth.storeId]);
    const num=Number(saleCounter.rows[0].last_number);
    const newSale=await c.query<{id:string}>(`INSERT INTO sales
      (store_id,sale_number,cash_session_id,cashier_id,total_cents,tendered_cents,change_cents,customer_id,seller_id)
      VALUES($1,$2,$3,$4,$5,$5,0,$6,$7) RETURNING id::text`,
     [auth.storeId,num,b.cash_session_id,auth.userId,outgoingValue,customerId||null,line.seller_id||auth.userId]);
    const newSaleId=newSale.rows[0].id;
    const lastCost=await c.query<{unit_cost_cents:string}>(`SELECT unit_cost_cents::text
      FROM purchase_orders WHERE store_id=$1 AND variant_id=$2 AND quality_finalized=true
      ORDER BY received_at DESC NULLS LAST,id DESC LIMIT 1`,[auth.storeId,b.replacement_variant_id]);
    const cost=lastCost.rows[0]?Number(lastCost.rows[0].unit_cost_cents):null;
    await c.query(`INSERT INTO sale_lines(store_id,sale_id,variant_id,product_name,sku,color,size,
      quantity,unit_price_cents,line_total_cents,cost_unit_cents)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
     [auth.storeId,newSaleId,b.replacement_variant_id,replacement.rows[0].name,
      replacement.rows[0].sku,replacement.rows[0].color,replacement.rows[0].size,
      b.replacement_quantity,replacement.rows[0].price_cents,outgoingValue,cost]);
    if(balance.exchange_payment_cents>0)await c.query(`INSERT INTO sale_payments
      (store_id,sale_id,method,amount_cents,confirmed_manually)
      VALUES($1,$2,'exchange_credit',$3,false)`,[auth.storeId,newSaleId,balance.exchange_payment_cents]);
    if(balance.extra_due_cents>0){
     await c.query(`INSERT INTO sale_payments(store_id,sale_id,method,amount_cents,
      external_reference,confirmed_manually) VALUES($1,$2,$3,$4,$5,true)`,
      [auth.storeId,newSaleId,b.payment!.method,balance.extra_due_cents,
       b.payment!.method==='cash'?null:b.payment!.external_reference!.trim()]);
    }
    const oldReturn=await c.query<{id:string}>(`INSERT INTO retail_after_sales
      (store_id,sale_id,kind,actor_id,amount_cents,replacement_sale_id,reason)
      VALUES($1,$2,'exchange',$3,$4,$5,$6) RETURNING id::text`,
      [auth.storeId,line.sale_id,auth.userId,returnedValue,newSaleId,b.reason.trim()]);
    const opId=oldReturn.rows[0].id;
    await c.query(`INSERT INTO retail_after_sale_lines
     (store_id,operation_id,sale_line_id,quantity,disposition,unit_amount_cents)
     VALUES($1,$2,$3,$4,$5,$6)`,
     [auth.storeId,opId,b.sale_line_id,b.quantity,b.condition,line.unit_price_cents]);
    await applyReturn(c,auth,opId,line.variant_id,b.quantity,b.condition);
    const adjusted=await c.query<{revision:string}>(`UPDATE stock_balances SET on_hand=on_hand-$3,
      revision=revision+1 WHERE store_id=$1 AND variant_id=$2 AND on_hand-reserved>=$3
      RETURNING revision::text`,[auth.storeId,b.replacement_variant_id,b.replacement_quantity]);
    if(!adjusted.rowCount)throw new DomainError(409,'REPLACEMENT_STOCK','Saldo mudou durante a troca');
    await c.query(`INSERT INTO stock_movements(store_id,variant_id,source_type,source_id,movement_kind,qty_delta)
      VALUES($1,$2,'sale',$3,'sale',$4)`,
     [auth.storeId,b.replacement_variant_id,newSaleId,-b.replacement_quantity]);
    await c.query(`INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload)
      VALUES($1,'inventory.stock.changed.v1',$2,$3,$4::jsonb)`,
     [auth.storeId,b.replacement_variant_id,Number(adjusted.rows[0].revision),JSON.stringify({sale_id:newSaleId,exchange_id:opId})]);
    if(balance.credit_cents>0)await c.query(`INSERT INTO retail_customer_credits
      (store_id,customer_id,source_type,source_id,amount_cents)
      VALUES($1,$2,'exchange',$3,$4)`,[auth.storeId,customerId,opId,balance.credit_cents]);
    const seller=line.seller_id||auth.userId;
    const rate=await c.query<{rate_bps:number}>(`SELECT rate_bps FROM retail_commission_rules
      WHERE store_id=$1 AND seller_id=$2`,[auth.storeId,seller]);
    if(rate.rows[0]?.rate_bps>0)await c.query(`INSERT INTO retail_commission_entries
      (store_id,sale_id,seller_id,base_cents,rate_bps,amount_cents)
      VALUES($1,$2,$3,$4,$5,$6)`,
      [auth.storeId,newSaleId,seller,outgoingValue,rate.rows[0].rate_bps,commissionCents(outgoingValue,rate.rows[0].rate_bps)]);
    await reverseLoyalty(c,auth,line.sale_id,line.customer_id,returnedValue);
    await reverseCommission(c,auth,line.sale_id,opId,returnedValue);
    if(customerId){
     const opt=await c.query<{loyalty_opt_in:boolean}>(`SELECT loyalty_opt_in
       FROM retail_customers WHERE store_id=$1 AND id=$2`,[auth.storeId,customerId]);
     if(opt.rows[0]?.loyalty_opt_in&&loyaltyPoints(outgoingValue)>0)
      await c.query(`INSERT INTO retail_loyalty_events
       (store_id,customer_id,sale_id,points,kind,note,actor_id)
       VALUES($1,$2,$3,$4,'earn','Pontos da troca presencial',$5)`,
       [auth.storeId,customerId,newSaleId,loyaltyPoints(outgoingValue),auth.userId]);
    }
    const oldStatus=await finalizeOldSale(c,auth.storeId,line.sale_id);
    await c.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
      VALUES($1,$2,'sales.exchange',$3,$4::jsonb)`,
      [auth.storeId,auth.userId,opId,JSON.stringify({original_sale_id:line.sale_id,
       replacement_sale_id:newSaleId,returned_cents:returnedValue,replacement_cents:outgoingValue,...balance})]);
    await c.query(`INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload)
      VALUES($1,'sales.sale.confirmed.v1',$2,1,$3::jsonb)`,
      [auth.storeId,newSaleId,JSON.stringify({sale_number:num,total_cents:outgoingValue})]);
    return {id:opId,old_status:oldStatus,replacement_sale_id:newSaleId,
      replacement_sale_number:num,returned_cents:returnedValue,replacement_cents:outgoingValue,...balance};
   });
  return reply.code(out.replayed?200:201).send({...out.result,replayed:out.replayed});
 });
}
