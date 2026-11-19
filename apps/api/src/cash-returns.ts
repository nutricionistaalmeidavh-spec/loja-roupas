import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { requirePermission } from './auth.ts';
import { expectedCash } from './cash.ts';
import { DomainError, requireIdempotencyKey, withIdempotentTransaction } from './transactions.ts';

const uuid={type:'string',pattern:'^[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$'};
const numberParams={type:'object',required:['number'],properties:{number:{type:'string',pattern:'^[1-9][0-9]{0,15}$'}}};
type SaleInfo = {id:string;sale_number:string;status:string;total_cents:string;cash_only:boolean};
const saleInfo = `SELECT s.id,s.sale_number,s.status,s.total_cents,
  NOT EXISTS(SELECT 1 FROM sale_payments p WHERE p.store_id=s.store_id AND p.sale_id=s.id AND p.method<>'cash') AS cash_only
  FROM sales s WHERE s.store_id=$1 AND s.sale_number=$2`;

export function registerCashReturns(app:FastifyInstance,db:Pool) {
  app.get<{Params:{number:string}}>('/v1/management/sales/by-number/:number',
    {schema:{params:numberParams}},async(request,reply)=>{
      if(requirePermission(request,reply,'sale.return'))return reply;
      const storeId=request.authContext!.storeId;
      const sale=await db.query<SaleInfo>(saleInfo,[storeId,request.params.number]);
      if(!sale.rowCount)throw new DomainError(404,'SALE_NOT_FOUND','Venda não encontrada');
      return sale.rows[0];
    });

  app.post<{Params:{number:string};Body:{cash_session_id:string;reason:string}}>('/v1/management/sales/by-number/:number/cash-return',{
    schema:{params:numberParams,body:{type:'object',additionalProperties:false,required:['cash_session_id','reason'],
      properties:{cash_session_id:uuid,reason:{type:'string',minLength:8,maxLength:250}}}},
  },async(request,reply)=>{
    if(requirePermission(request,reply,'sale.return'))return reply;
    const auth=request.authContext!;
    const key=requireIdempotencyKey(request.headers['idempotency-key']);
    const saleNumber=request.params.number;
    const {cash_session_id}=request.body;
    const reason=request.body.reason.trim();
    if(reason.length<8)throw new DomainError(422,'RETURN_REASON','Justifique a devolução com pelo menos 8 caracteres');
    const out=await withIdempotentTransaction(db,auth,'cash.return:'+saleNumber,key,{cash_session_id,reason},async client=>{
      const session=await client.query<{opening_cents:string;closed_at:Date|null}>(`SELECT opening_cents,closed_at
        FROM cash_sessions WHERE store_id=$1 AND id=$2 FOR UPDATE`,[auth.storeId,cash_session_id]);
      if(!session.rows[0] || session.rows[0].closed_at)
        throw new DomainError(409,'CASH_CLOSED','Abra o caixa antes de registrar a devolução');
      const result=await client.query<SaleInfo>(saleInfo+' FOR UPDATE OF s',[auth.storeId,saleNumber]);
      const sale=result.rows[0];
      if(!sale)throw new DomainError(404,'SALE_NOT_FOUND','Venda não encontrada');
      if(sale.status!=='confirmed')throw new DomainError(409,'RETURN_INELIGIBLE','A venda não está disponível para devolução integral');
      if(!sale.cash_only)throw new DomainError(422,'RETURN_METHOD','A devolução por este fluxo exige venda paga só em dinheiro');
      const amount=Number(sale.total_cents);
      const cash=await expectedCash(client,auth.storeId,cash_session_id,Number(session.rows[0].opening_cents));
      if(!Number.isSafeInteger(amount)||amount>cash)throw new DomainError(409,'INSUFFICIENT_CASH','Saldo insuficiente para a devolução');
      const lines=await client.query<{variant_id:string;quantity:string}>(`SELECT variant_id,sum(quantity)::text AS quantity
        FROM sale_lines WHERE store_id=$1 AND sale_id=$2 GROUP BY variant_id ORDER BY variant_id`,[auth.storeId,sale.id]);
      const created=await client.query<{id:string}>(`INSERT INTO cash_sale_returns(store_id,sale_id,cash_session_id,actor_id,amount_cents,reason)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[auth.storeId,sale.id,cash_session_id,auth.userId,amount,reason]);
      const returnId=created.rows[0].id;
      for(const line of lines.rows){
        const balance=await client.query<{revision:string}>(`UPDATE stock_balances SET on_hand=on_hand+$3,revision=revision+1
          WHERE store_id=$1 AND variant_id=$2 RETURNING revision`,[auth.storeId,line.variant_id,line.quantity]);
        if(!balance.rowCount)throw new DomainError(409,'INCONSISTENT_STOCK','Saldo não encontrado para uma peça da devolução');
        await client.query(`INSERT INTO stock_movements(store_id,variant_id,source_type,source_id,movement_kind,qty_delta)
          VALUES($1,$2,'sale_return',$3,'return',$4)`,[auth.storeId,line.variant_id,returnId,line.quantity]);
        await client.query(`INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload)
          VALUES($1,'inventory.stock.changed.v1',$2,$3,$4::jsonb)`,
          [auth.storeId,line.variant_id,balance.rows[0].revision,JSON.stringify({return_id:returnId,sale_id:sale.id})]);
      }
      if(amount>0)await client.query(`INSERT INTO cash_movements(store_id,cash_session_id,actor_id,kind,amount_cents,reason)
        VALUES($1,$2,$3,'refund',$4,$5)`,[auth.storeId,cash_session_id,auth.userId,amount,reason]);
      await client.query("UPDATE sales SET status='returned' WHERE store_id=$1 AND id=$2",[auth.storeId,sale.id]);
      await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
        VALUES($1,$2,'sales.return.cash',$3,$4::jsonb)`,
        [auth.storeId,auth.userId,sale.id,JSON.stringify({return_id:returnId,amount_cents:amount,cash_session_id,reason})]);
      return {id:returnId,sale_id:sale.id,refunded_cents:amount,expected_cash_cents:cash-amount};
    });
    return reply.code(201).send(out.result);
  });
}
