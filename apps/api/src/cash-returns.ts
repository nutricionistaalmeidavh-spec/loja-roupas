import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { requirePermission } from './auth.ts';
import { expectedCash } from './cash.ts';
import { DomainError, requireIdempotencyKey, withIdempotentTransaction } from './transactions.ts';

const uuid={type:'string',pattern:'^[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$'};
const numberParams={type:'object',required:['number'],properties:{number:{type:'string',pattern:'^[1-9][0-9]{0,15}$'}}};
type SaleInfo={id:string;sale_number:string;status:string;total_cents:string;cash_only:boolean};
type ReturnItem={sale_line_id:string;quantity:number;condition:'resellable'|'quarantine'};
type SaleLine={id:string;variant_id:string;quantity:string;unit_price_cents:string;returned_quantity:string};
const saleInfo=`SELECT s.id,s.sale_number,s.status,s.total_cents,
  NOT EXISTS(SELECT 1 FROM sale_payments p WHERE p.store_id=s.store_id AND p.sale_id=s.id AND p.method<>'cash') AS cash_only
  FROM sales s WHERE s.store_id=$1 AND s.sale_number=$2`;
const linesQuery=`SELECT l.id,l.variant_id,l.product_name,l.sku,l.color,l.size,l.quantity::text,
 l.unit_price_cents::text,
 coalesce((SELECT sum(rl.quantity) FROM cash_return_lines rl
    JOIN cash_sale_returns r ON r.id=rl.return_id AND r.store_id=rl.store_id
    WHERE rl.store_id=l.store_id AND rl.sale_line_id=l.id AND r.sale_id=l.sale_id),0)::text AS returned_quantity
 FROM sale_lines l WHERE l.store_id=$1 AND l.sale_id=$2 ORDER BY l.id`;

export function registerCashReturns(app:FastifyInstance,db:Pool){
 app.get<{Params:{number:string}}>('/v1/management/sales/by-number/:number',
  {schema:{params:numberParams}},async(request,reply)=>{
   if(requirePermission(request,reply,'sale.return'))return reply;
   const store=request.authContext!.storeId;
   const sale=await db.query<SaleInfo>(saleInfo,[store,request.params.number]);
   if(!sale.rowCount)throw new DomainError(404,'SALE_NOT_FOUND','Venda não encontrada');
   const lines=await db.query<SaleLine>(linesQuery,[store,sale.rows[0].id]);
   return {...sale.rows[0],lines:lines.rows.map(line=>({
    id:line.id,variant_id:line.variant_id,product_name:(line as SaleLine & {product_name:string}).product_name,
    sku:(line as SaleLine & {sku:string}).sku,color:(line as SaleLine & {color:string}).color,
    size:(line as SaleLine & {size:string}).size,
    quantity:Number(line.quantity),unit_price_cents:Number(line.unit_price_cents),
    returned_quantity:Number(line.returned_quantity),
    available_to_return:Number(line.quantity)-Number(line.returned_quantity)
   }))};
  });

 app.post<{Params:{number:string};Body:{cash_session_id:string;reason:string;items:ReturnItem[]}}>(
  '/v1/management/sales/by-number/:number/cash-return',{
   schema:{params:numberParams,body:{type:'object',additionalProperties:false,
    required:['cash_session_id','reason','items'],properties:{
      cash_session_id:uuid,reason:{type:'string',minLength:8,maxLength:250},
      items:{type:'array',minItems:1,maxItems:100,items:{
       type:'object',additionalProperties:false,required:['sale_line_id','quantity','condition'],
       properties:{sale_line_id:uuid,quantity:{type:'integer',minimum:1,maximum:10000},
        condition:{type:'string',enum:['resellable','quarantine']}}
      }}
    }}
   }
  },async(request,reply)=>{
   if(requirePermission(request,reply,'sale.return'))return reply;
   const auth=request.authContext!;
   const {cash_session_id,items}=request.body;
   const reason=request.body.reason.trim();
   if(reason.length<8)throw new DomainError(422,'RETURN_REASON','Justifique a devolução com pelo menos 8 caracteres');
   if(new Set(items.map(x=>x.sale_line_id)).size!==items.length)
    throw new DomainError(422,'DUPLICATE_RETURN_LINE','A mesma peça não pode aparecer duas vezes na devolução');
   const key=requireIdempotencyKey(request.headers['idempotency-key']);
   const saleNumber=request.params.number;
   const out=await withIdempotentTransaction(db,auth,'cash.return:'+saleNumber,key,request.body,async client=>{
    const cash=await client.query<{opening_cents:string;opened_by:string;closed_at:Date|null}>(`SELECT opening_cents,opened_by,closed_at
      FROM cash_sessions WHERE store_id=$1 AND id=$2 FOR UPDATE`,[auth.storeId,cash_session_id]);
    if(!cash.rows[0]||cash.rows[0].closed_at)
      throw new DomainError(409,'CASH_CLOSED','Abra o caixa antes de registrar a devolução');
    if(!auth.roles.includes('manager')&&cash.rows[0].opened_by!==auth.userId)
      throw new DomainError(403,'CASH_OWNER','Este caixa pertence a outro operador');
    const result=await client.query<SaleInfo>(saleInfo+' FOR UPDATE OF s',[auth.storeId,saleNumber]);
    const sale=result.rows[0];
    if(!sale)throw new DomainError(404,'SALE_NOT_FOUND','Venda não encontrada');
    if(!['confirmed','partially_returned'].includes(sale.status))
      throw new DomainError(409,'RETURN_INELIGIBLE','Esta venda não possui peças disponíveis para devolução');
    if(!sale.cash_only)
      throw new DomainError(422,'RETURN_METHOD','Devolução em dinheiro exige venda originalmente paga só em dinheiro');
    const saleLines=await client.query<SaleLine>(linesQuery,[auth.storeId,sale.id]);
    const available=new Map(saleLines.rows.map(line=>[line.id,line]));
    let amount=0;
    for(const item of items){
      const line=available.get(item.sale_line_id);
      if(!line||item.quantity>Number(line.quantity)-Number(line.returned_quantity))
        throw new DomainError(409,'RETURN_QUANTITY','Peça indisponível ou quantidade já devolvida');
      const portion=item.quantity*Number(line.unit_price_cents);
      if(!Number.isSafeInteger(portion)||!Number.isSafeInteger(amount+portion))
        throw new DomainError(422,'RETURN_TOTAL_OVERFLOW','Valor da devolução fora dos limites');
      amount+=portion;
    }
    const cashExpected=await expectedCash(client,auth.storeId,cash_session_id,Number(cash.rows[0].opening_cents));
    if(amount>cashExpected)
      throw new DomainError(409,'INSUFFICIENT_CASH','Saldo insuficiente para a devolução');
    const created=await client.query<{id:string}>(`INSERT INTO cash_sale_returns(store_id,sale_id,cash_session_id,actor_id,amount_cents,reason)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[auth.storeId,sale.id,cash_session_id,auth.userId,amount,reason]);
    const returnId=created.rows[0].id;
    for(const item of items){
      const line=available.get(item.sale_line_id)!;
      await client.query(`INSERT INTO cash_return_lines(store_id,return_id,sale_line_id,quantity,disposition,unit_amount_cents)
        VALUES($1,$2,$3,$4,$5,$6)`,
        [auth.storeId,returnId,line.id,item.quantity,item.condition,line.unit_price_cents]);
      if(item.condition==='resellable'){
        const balance=await client.query<{revision:string}>(`UPDATE stock_balances
          SET on_hand=on_hand+$3,revision=revision+1
          WHERE store_id=$1 AND variant_id=$2 RETURNING revision`,
          [auth.storeId,line.variant_id,item.quantity]);
        if(!balance.rowCount)
          throw new DomainError(409,'INCONSISTENT_STOCK','Saldo não encontrado para peça devolvida');
        await client.query(`INSERT INTO stock_movements(store_id,variant_id,source_type,source_id,movement_kind,qty_delta)
          VALUES($1,$2,'sale_return',$3,'return',$4)`,[auth.storeId,line.variant_id,returnId,item.quantity]);
        await client.query(`INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload)
          VALUES($1,'inventory.stock.changed.v1',$2,$3,$4::jsonb)`,
          [auth.storeId,line.variant_id,balance.rows[0].revision,JSON.stringify({return_id:returnId,sale_id:sale.id})]);
      } else {
        await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
          VALUES($1,$2,'inventory.return.quarantine',$3,$4::jsonb)`,
          [auth.storeId,auth.userId,line.variant_id,JSON.stringify({return_id:returnId,sale_id:sale.id,quantity:item.quantity})]);
      }
    }
    if(amount>0)await client.query(`INSERT INTO cash_movements(store_id,cash_session_id,actor_id,kind,amount_cents,reason)
      VALUES($1,$2,$3,'refund',$4,$5)`,[auth.storeId,cash_session_id,auth.userId,amount,reason]);
    const totals=await client.query<{quantity:string;returned:string}>(`SELECT
      coalesce(sum(l.quantity),0)::text AS quantity,
      coalesce(sum((SELECT coalesce(sum(rl.quantity),0) FROM cash_return_lines rl
       JOIN cash_sale_returns r ON r.id=rl.return_id AND r.store_id=rl.store_id
       WHERE rl.store_id=l.store_id AND rl.sale_line_id=l.id AND r.sale_id=l.sale_id)),0)::text AS returned
      FROM sale_lines l WHERE l.store_id=$1 AND l.sale_id=$2`,[auth.storeId,sale.id]);
    const complete=totals.rows[0].quantity===totals.rows[0].returned;
    await client.query('UPDATE sales SET status=$3 WHERE store_id=$1 AND id=$2',
      [auth.storeId,sale.id,complete?'returned':'partially_returned']);
    await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
      VALUES($1,$2,'sales.return',$3,$4::jsonb)`,
      [auth.storeId,auth.userId,sale.id,JSON.stringify({return_id:returnId,amount_cents:amount,cash_session_id,reason,items})]);
    return {id:returnId,sale_id:sale.id,refunded_cents:amount,
      expected_cash_cents:cashExpected-amount,status:complete?'returned':'partially_returned'};
   });
   return reply.code(201).send(out.result);
  });
}
