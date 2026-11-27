import type {FastifyInstance} from 'fastify';
import type {Pool} from 'pg';
import {requirePermission} from './auth.ts';
import {DomainError,requireIdempotencyKey,withIdempotentTransaction} from './transactions.ts';
import {commissionCents,creditInstallments,dreTotals,loyaltyPoints,settlementAllowed,validDate} from './retail-rules.ts';
import {expectedCash} from './cash.ts';
const uuid='^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$';
const params={type:'object',required:['id'],properties:{id:{type:'string',pattern:uuid}}};
const money={type:'integer',minimum:1,maximum:999999999999};
const key=(h:unknown)=>requireIdempotencyKey(h);
const can=(v:number)=>Number.isSafeInteger(v)&&v>0&&v<=999999999999;

/**
 * Comissão retida: com a regra "depois do pagamento", a parte da comissão proporcional ao
 * crediário ainda em aberto da venda só pode ser paga ao vendedor quando a cliente pagar.
 */
const heldCommissionSql=(seller:string)=>`(SELECT coalesce(sum(LEAST(e.amount_cents,
   ceil(e.amount_cents*o.cents::numeric/NULLIF(e.base_cents,0)))),0)
  FROM retail_commission_entries e
  JOIN (SELECT source_id,sum(amount_cents-settled_cents) AS cents FROM retail_accounts
   WHERE store_id=$1 AND kind='receivable' AND source_type='sale_credit' AND cancelled_at IS NULL
   GROUP BY source_id) o ON o.source_id=e.sale_id
  WHERE e.store_id=$1 AND e.seller_id=${seller}
   AND (SELECT commission_timing FROM stores WHERE id=$1)='on_payment')`;
export function registerRetailLedger(app:FastifyInstance,db:Pool){
 app.get<{Querystring:{kind?:'payable'|'receivable'}}>('/v1/management/accounts',{
  schema:{querystring:{type:'object',additionalProperties:false,properties:{kind:{type:'string',enum:['payable','receivable']}}}}
 },async(req,reply)=>{
  if(requirePermission(req,reply,'finance.read'))return reply;
  const q=await db.query(`SELECT a.id::text,a.kind,a.description,a.amount_cents::text,a.settled_cents::text,
    a.due_on::text,a.created_at,a.customer_id::text,a.supplier_id::text
   FROM retail_accounts a WHERE a.store_id=$1 AND a.cancelled_at IS NULL
    AND ($2::text IS NULL OR a.kind=$2) ORDER BY a.due_on,a.id LIMIT 200`,
   [req.authContext!.storeId,req.query.kind||null]);
  return {items:q.rows};
 });
 app.post<{Body:{kind:'payable'|'receivable';description:string;amount_cents:number;due_on:string;
  customer_id?:string;supplier_id?:string;recognized_on?:string;category?:string}}>('/v1/management/accounts',{
  schema:{body:{type:'object',additionalProperties:false,required:['kind','description','amount_cents','due_on'],
   properties:{kind:{type:'string',enum:['payable','receivable']},description:{type:'string',minLength:3,maxLength:240},
    amount_cents:money,due_on:{type:'string',maxLength:10},
    recognized_on:{type:'string',maxLength:10},category:{type:'string',minLength:1,maxLength:80},
    customer_id:{type:'string',pattern:uuid},
    supplier_id:{type:'string',pattern:uuid}}}}
 },async(req,reply)=>{
  if(requirePermission(req,reply,'finance.write'))return reply;
  const auth=req.authContext!,body=req.body;
  if(!validDate(body.due_on)||body.recognized_on&&!validDate(body.recognized_on))
   throw new DomainError(422,'INVALID_DATE','Vencimento ou competência inválidos');
  if(body.kind==='receivable'&&(body.recognized_on||body.category))
   throw new DomainError(422,'ACCOUNT_KIND','Reconhecimento de despesa é somente para contas a pagar');
  if(body.kind==='receivable'&&body.supplier_id||body.kind==='payable'&&body.customer_id)
   throw new DomainError(422,'ACCOUNT_LINK','Cliente/fornecedor incompatível com o tipo');
  const out=await withIdempotentTransaction(db,auth,'retail.account.create',key(req.headers['idempotency-key']),body,async client=>{
   let expenseId:string|null=null;
   if(body.kind==='payable'){
    const expense=await client.query<{id:string}>(`INSERT INTO operating_expenses
     (store_id,created_by,category,description,amount_cents,occurred_on)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text`,
     [auth.storeId,auth.userId,body.category||'Contas a pagar',body.description.trim(),
      body.amount_cents,body.recognized_on||body.due_on]);
    expenseId=expense.rows[0].id;
   }
   const q=await client.query<{id:string}>(`INSERT INTO retail_accounts
    (store_id,kind,customer_id,supplier_id,description,amount_cents,due_on,
     recognized_on,expense_category,expense_record_id,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id::text`,
    [auth.storeId,body.kind,body.customer_id||null,body.supplier_id||null,body.description.trim(),
     body.amount_cents,body.due_on,body.kind==='payable'?(body.recognized_on||body.due_on):null,
     body.kind==='payable'?(body.category||'Contas a pagar'):null,expenseId,auth.userId]);
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id)
    VALUES($1,$2,'accounts.create',$3)`,[auth.storeId,auth.userId,q.rows[0].id]);
   return {id:q.rows[0].id,...body};
  });
  return reply.code(out.replayed?200:201).send({...out.result,replayed:out.replayed});
 });
 app.post<{Params:{id:string};Body:{amount_cents:number;method:'cash'|'pix_manual'|'card_external'|'bank_transfer';
  external_reference?:string;cash_session_id?:string}}>('/v1/management/accounts/:id/settlements',{
  schema:{params,body:{type:'object',additionalProperties:false,required:['amount_cents','method'],properties:{
   amount_cents:money,method:{type:'string',enum:['cash','pix_manual','card_external','bank_transfer']},
   external_reference:{type:'string',maxLength:128},cash_session_id:{type:'string',pattern:uuid}}}}
 },async(req,reply)=>{
  if(requirePermission(req,reply,'finance.write'))return reply;
  const auth=req.authContext!,body=req.body,id=req.params.id;
  if(body.method==='cash'?Boolean(body.external_reference)||!body.cash_session_id:
   Boolean(body.cash_session_id)||!body.external_reference||body.external_reference.trim().length<6)
   throw new DomainError(422,'SETTLEMENT_PROOF','Pagamento em dinheiro exige caixa; pagamento externo exige comprovante');
  const out=await withIdempotentTransaction(db,auth,'retail.account.settle:'+id,key(req.headers['idempotency-key']),body,async client=>{
   const rows=await client.query<{kind:string;amount_cents:string;settled_cents:string;cancelled_at:Date|null;
    source_type:string;customer_id:string|null}>(`
    SELECT kind,amount_cents::text,settled_cents::text,cancelled_at,source_type,customer_id::text
    FROM retail_accounts WHERE store_id=$1 AND id=$2 FOR UPDATE`,[auth.storeId,id]);
   const account=rows.rows[0];
   if(!account||account.cancelled_at)throw new DomainError(409,'ACCOUNT_CLOSED','Conta inexistente ou cancelada');
   const remaining=settlementAllowed(Number(account.amount_cents),Number(account.settled_cents),body.amount_cents);
   if(body.method==='cash'){
    const cash=await client.query<{opening_cents:string;opened_by:string;closed_at:Date|null}>(`
     SELECT opening_cents::text,opened_by::text,closed_at FROM cash_sessions
     WHERE store_id=$1 AND id=$2 FOR UPDATE`,[auth.storeId,body.cash_session_id]);
    if(!cash.rowCount||cash.rows[0].closed_at)throw new DomainError(409,'CASH_CLOSED','Caixa não está aberto');
    if(!auth.roles.includes('manager')&&cash.rows[0].opened_by!==auth.userId)
     throw new DomainError(403,'CASH_OWNER','Caixa de outro operador');
    if(account.kind==='payable'){
     const cashTotal=await expectedCash(client,auth.storeId,body.cash_session_id!,Number(cash.rows[0].opening_cents));
     if(body.amount_cents>cashTotal)throw new DomainError(409,'INSUFFICIENT_CASH','Dinheiro insuficiente');
    }
    await client.query(`INSERT INTO cash_movements
     (store_id,cash_session_id,actor_id,kind,amount_cents,reason)
     VALUES($1,$2,$3,$4,$5,$6)`,
     [auth.storeId,body.cash_session_id,auth.userId,account.kind==='receivable'?'credit_collection':'account_payment',
      body.amount_cents,'Liquidação de conta '+id]);
   }
   const item=await client.query<{id:string}>(`INSERT INTO retail_account_settlements
    (store_id,account_id,amount_cents,method,external_reference,cash_session_id,actor_id)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id::text`,
    [auth.storeId,id,body.amount_cents,body.method,body.method==='cash'?null:body.external_reference!.trim(),
     body.cash_session_id||null,auth.userId]);
   await client.query(`UPDATE retail_accounts SET settled_cents=settled_cents+$3
    WHERE store_id=$1 AND id=$2`,[auth.storeId,id,body.amount_cents]);
   // Crediário rende pontos quando o cliente paga, não no dia da venda.
   if(account.kind==='receivable'&&account.source_type==='sale_credit'&&account.customer_id&&loyaltyPoints(body.amount_cents)>0){
    const opt=await client.query<{loyalty_opt_in:boolean}>(`SELECT loyalty_opt_in FROM retail_customers
     WHERE store_id=$1 AND id=$2 AND anonymized_at IS NULL`,[auth.storeId,account.customer_id]);
    if(opt.rows[0]?.loyalty_opt_in)await client.query(`INSERT INTO retail_loyalty_events
     (store_id,customer_id,points,kind,note,actor_id) VALUES($1,$2,$3,'earn',$4,$5)`,
     [auth.storeId,account.customer_id,loyaltyPoints(body.amount_cents),'Pontos do pagamento do crediário',auth.userId]);
   }
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
    VALUES($1,$2,'accounts.settle',$3,$4::jsonb)`,
    [auth.storeId,auth.userId,id,JSON.stringify({settlement_id:item.rows[0].id,method:body.method,amount_cents:body.amount_cents})]);
   return {id:item.rows[0].id,account_id:id,remaining_cents:remaining};
  });
  return reply.code(out.replayed?200:201).send({...out.result,replayed:out.replayed});
 });

 app.get('/v1/management/credit-limits',async(req,reply)=>{
  if(requirePermission(req,reply,'finance.read'))return reply;
  const rows=await db.query(`SELECT c.id::text,c.name,l.credit_limit_cents::text,l.enabled,
   COALESCE((SELECT sum(a.amount_cents-a.settled_cents) FROM retail_accounts a
    WHERE a.store_id=c.store_id AND a.customer_id=c.id AND a.kind='receivable'
      AND a.cancelled_at IS NULL),0)::text AS outstanding_cents
   FROM retail_customers c LEFT JOIN retail_credit_limits l ON l.store_id=c.store_id AND l.customer_id=c.id
   WHERE c.store_id=$1 AND c.anonymized_at IS NULL ORDER BY lower(c.name) LIMIT 200`,
   [req.authContext!.storeId]);
  return {items:rows.rows};
 });
 app.post<{Params:{id:string};Body:{enabled:boolean;credit_limit_cents:number}}>('/v1/management/customers/:id/credit-limit',{
  schema:{params,body:{type:'object',additionalProperties:false,required:['enabled','credit_limit_cents'],
   properties:{enabled:{type:'boolean'},credit_limit_cents:{type:'integer',minimum:0,maximum:9999999999}}}}
 },async(req,reply)=>{
  if(requirePermission(req,reply,'finance.write'))return reply;
  const auth=req.authContext!,body=req.body;
  const out=await withIdempotentTransaction(db,auth,'retail.credit.limit:'+req.params.id,key(req.headers['idempotency-key']),body,async client=>{
   const c=await client.query(`SELECT id FROM retail_customers WHERE store_id=$1 AND id=$2
    AND anonymized_at IS NULL FOR UPDATE`,[auth.storeId,req.params.id]);
   if(!c.rowCount)throw new DomainError(404,'CUSTOMER_NOT_FOUND','Cliente não encontrado');
   await client.query(`INSERT INTO retail_credit_limits
    (store_id,customer_id,enabled,credit_limit_cents,updated_by) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(store_id,customer_id) DO UPDATE SET enabled=EXCLUDED.enabled,
     credit_limit_cents=EXCLUDED.credit_limit_cents,updated_by=EXCLUDED.updated_by,updated_at=now()`,
    [auth.storeId,req.params.id,body.enabled,body.credit_limit_cents,auth.userId]);
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id)
    VALUES($1,$2,'credit.limit.change',$3)`,[auth.storeId,auth.userId,req.params.id]);
   return {customer_id:req.params.id,...body};
  });
  return out.result;
 });
 app.get('/v1/management/commissions',async(req,reply)=>{
  if(requirePermission(req,reply,'finance.read'))return reply;
  const q=await db.query(`SELECT u.id::text AS seller_id,u.login,
   coalesce(r.rate_bps,0)::int AS rate_bps,
   (coalesce((SELECT sum(e.amount_cents) FROM retail_commission_entries e
    WHERE e.store_id=$1 AND e.seller_id=u.id),0)
    -coalesce((SELECT sum(x.amount_cents) FROM retail_commission_reversals x
     WHERE x.store_id=$1 AND x.seller_id=u.id),0))::text AS accrued_cents,
   ${heldCommissionSql('u.id')}::text AS held_cents,
   coalesce((SELECT sum(p.amount_cents) FROM retail_commission_payouts p
    WHERE p.store_id=$1 AND p.seller_id=u.id),0)::text AS paid_cents
   FROM users u JOIN user_store_roles ur ON ur.user_id=u.id AND ur.store_id=$1
   LEFT JOIN retail_commission_rules r ON r.store_id=$1 AND r.seller_id=u.id
   WHERE u.status='active' GROUP BY u.id,u.login,r.rate_bps ORDER BY u.login LIMIT 100`,
   [req.authContext!.storeId]);
  return {items:q.rows};
 });
 app.post<{Params:{id:string};Body:{rate_bps:number}}>('/v1/management/commissions/:id/rule',{
  schema:{params,body:{type:'object',additionalProperties:false,required:['rate_bps'],
   properties:{rate_bps:{type:'integer',minimum:0,maximum:10000}}}}
 },async(req,reply)=>{
  if(requirePermission(req,reply,'finance.write'))return reply;
  const auth=req.authContext!,body=req.body; commissionCents(0,body.rate_bps);
  const out=await withIdempotentTransaction(db,auth,'retail.commission.rule:'+req.params.id,
   key(req.headers['idempotency-key']),body,async client=>{
   const exists=await client.query(`SELECT 1 FROM user_store_roles r JOIN users u ON u.id=r.user_id
    WHERE r.store_id=$1 AND r.user_id=$2 AND u.status='active'`,[auth.storeId,req.params.id]);
   if(!exists.rowCount)throw new DomainError(404,'SELLER_NOT_FOUND','Vendedor não cadastrado nesta loja');
   await client.query(`INSERT INTO retail_commission_rules(store_id,seller_id,rate_bps,updated_by)
    VALUES($1,$2,$3,$4) ON CONFLICT(store_id,seller_id)
    DO UPDATE SET rate_bps=EXCLUDED.rate_bps,updated_by=EXCLUDED.updated_by,updated_at=now()`,
    [auth.storeId,req.params.id,body.rate_bps,auth.userId]);
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id)
    VALUES($1,$2,'commissions.rule.change',$3)`,[auth.storeId,auth.userId,req.params.id]);
   return {seller_id:req.params.id,rate_bps:body.rate_bps};
  });
  return out.result;
 });

 app.post<{Params:{id:string};Body:{amount_cents:number;method:'cash'|'bank_transfer';
  cash_session_id?:string;external_reference?:string}}>('/v1/management/commissions/:id/payout',{
  schema:{params,body:{type:'object',additionalProperties:false,required:['amount_cents','method'],
   properties:{amount_cents:money,method:{type:'string',enum:['cash','bank_transfer']},
    cash_session_id:{type:'string',pattern:uuid},external_reference:{type:'string',minLength:6,maxLength:128}}}}
 },async(req,reply)=>{
  if(requirePermission(req,reply,'finance.write'))return reply;
  const auth=req.authContext!,b=req.body;
  if(b.method==='cash'?(!b.cash_session_id||b.external_reference):
   (!b.external_reference||b.cash_session_id))
   throw new DomainError(422,'COMMISSION_PAYOUT_PROOF','Dinheiro exige caixa; transferência exige referência');
  const out=await withIdempotentTransaction(db,auth,'retail.commission.payout:'+req.params.id,
   key(req.headers['idempotency-key']),b,async client=>{
   const rule=await client.query(`SELECT 1 FROM retail_commission_rules
    WHERE store_id=$1 AND seller_id=$2 FOR UPDATE`,[auth.storeId,req.params.id]);
   if(!rule.rowCount)throw new DomainError(404,'COMMISSION_RULE_MISSING','Defina taxa antes de liquidar comissões');
   const sums=await client.query<{accrued:string;reversed:string;paid:string;held:string}>(`SELECT
    (SELECT coalesce(sum(amount_cents),0)::text FROM retail_commission_entries
     WHERE store_id=$1 AND seller_id=$2) AS accrued,
    (SELECT coalesce(sum(amount_cents),0)::text FROM retail_commission_reversals
     WHERE store_id=$1 AND seller_id=$2) AS reversed,
    (SELECT coalesce(sum(amount_cents),0)::text FROM retail_commission_payouts
     WHERE store_id=$1 AND seller_id=$2) AS paid,
    ${heldCommissionSql('$2')}::text AS held`,[auth.storeId,req.params.id]);
   const due=Number(sums.rows[0].accrued)-Number(sums.rows[0].reversed)-Number(sums.rows[0].paid)-Number(sums.rows[0].held);
   if(b.amount_cents>due)throw new DomainError(409,'COMMISSION_DUE',Number(sums.rows[0].held)>0
    ?'Valor supera a comissão liberada; parte dela aguarda a cliente pagar o crediário':'Valor supera comissão devida');
   if(b.method==='cash'){
    const cash=await client.query<{opening_cents:string;opened_by:string;closed_at:Date|null}>(`SELECT opening_cents::text,opened_by::text,closed_at
     FROM cash_sessions WHERE store_id=$1 AND id=$2 FOR UPDATE`,[auth.storeId,b.cash_session_id]);
    if(!cash.rowCount||cash.rows[0].closed_at)throw new DomainError(409,'CASH_CLOSED','Caixa não aberto');
    if(!auth.roles.includes('manager')&&cash.rows[0].opened_by!==auth.userId)
     throw new DomainError(403,'CASH_OWNER','Caixa de outro operador');
    const available=await expectedCash(client,auth.storeId,b.cash_session_id!,Number(cash.rows[0].opening_cents));
    if(b.amount_cents>available)throw new DomainError(409,'INSUFFICIENT_CASH','Dinheiro insuficiente');
    await client.query(`INSERT INTO cash_movements(store_id,cash_session_id,actor_id,kind,amount_cents,reason)
     VALUES($1,$2,$3,'commission_payment',$4,$5)`,
     [auth.storeId,b.cash_session_id,auth.userId,b.amount_cents,'Comissão vendedor '+req.params.id]);
   }
   const q=await client.query<{id:string}>(`INSERT INTO retail_commission_payouts
    (store_id,seller_id,amount_cents,method,cash_session_id,external_reference,actor_id)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id::text`,
    [auth.storeId,req.params.id,b.amount_cents,b.method,b.cash_session_id||null,
     b.method==='cash'?null:b.external_reference!.trim(),auth.userId]);
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
    VALUES($1,$2,'commissions.payout',$3,$4::jsonb)`,
    [auth.storeId,auth.userId,q.rows[0].id,
     JSON.stringify({seller_id:req.params.id,amount_cents:b.amount_cents,method:b.method})]);
   return {id:q.rows[0].id,remaining_cents:due-b.amount_cents};
  });
  return reply.code(out.replayed?200:201).send({...out.result,replayed:out.replayed});
 });
 app.get<{Params:{id:string}}>('/v1/management/customers/:id/loyalty',{schema:{params}},async(req,reply)=>{
  if(requirePermission(req,reply,'customer.read'))return reply;
  const c=await db.query(`SELECT id FROM retail_customers WHERE store_id=$1 AND id=$2 AND anonymized_at IS NULL`,
   [req.authContext!.storeId,req.params.id]);
  if(!c.rowCount)throw new DomainError(404,'CUSTOMER_NOT_FOUND','Cliente não encontrado');
  const q=await db.query<{points:string}>(`SELECT coalesce(sum(points),0)::text AS points
   FROM retail_loyalty_events WHERE store_id=$1 AND customer_id=$2`,[req.authContext!.storeId,req.params.id]);
  const credit=await db.query<{cents:string}>(`SELECT coalesce(sum(amount_cents-used_cents),0)::text AS cents
   FROM retail_customer_credits WHERE store_id=$1 AND customer_id=$2`,[req.authContext!.storeId,req.params.id]);
  return {customer_id:req.params.id,points:Number(q.rows[0].points),credit_cents:Number(credit.rows[0].cents)};
 });
 app.post<{Params:{id:string};Body:{points:number}}>('/v1/management/customers/:id/loyalty/redeem',{
  schema:{params,body:{type:'object',additionalProperties:false,required:['points'],
   properties:{points:{type:'integer',minimum:100,maximum:1000000}}}}
 },async(req,reply)=>{
  if(requirePermission(req,reply,'customer.write'))return reply;
  const auth=req.authContext!,id=req.params.id,points=req.body.points;
  const out=await withIdempotentTransaction(db,auth,'retail.loyalty.redeem:'+id,
   key(req.headers['idempotency-key']),req.body,async client=>{
   const exists=await client.query(`SELECT id FROM retail_customers WHERE store_id=$1 AND id=$2
    AND anonymized_at IS NULL FOR UPDATE`,[auth.storeId,id]);
   if(!exists.rowCount)throw new DomainError(404,'CUSTOMER_NOT_FOUND','Cliente não encontrado');
   const q=await client.query<{balance:string}>(`SELECT coalesce(sum(points),0)::text AS balance
    FROM retail_loyalty_events WHERE store_id=$1 AND customer_id=$2`,[auth.storeId,id]);
   if(Number(q.rows[0].balance)<points)throw new DomainError(409,'INSUFFICIENT_POINTS','Pontos insuficientes');
   const event=await client.query<{id:string}>(`INSERT INTO retail_loyalty_events
    (store_id,customer_id,points,kind,note,actor_id) VALUES($1,$2,$3,'redeem',$4,$5)
    RETURNING id::text`,[auth.storeId,id,-points,'Resgate em crédito de loja, 1 ponto = 1 centavo',auth.userId]);
   await client.query(`INSERT INTO retail_customer_credits
    (store_id,customer_id,source_type,source_id,amount_cents)
    VALUES($1,$2,'loyalty',$3,$4)`,[auth.storeId,id,event.rows[0].id,points]);
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id)
    VALUES($1,$2,'loyalty.redeem',$3)`,[auth.storeId,auth.userId,event.rows[0].id]);
   return {event_id:event.rows[0].id,points_redeemed:points,credit_cents:points};
  });
  return reply.code(out.replayed?200:201).send(out.result);
 });

 app.get<{Querystring:{month:string}}>('/v1/management/dre',{
  schema:{querystring:{type:'object',additionalProperties:false,required:['month'],properties:{month:{type:'string',maxLength:7}}}}
 },async(req,reply)=>{
  if(requirePermission(req,reply,'finance.read'))return reply;
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month))
   throw new DomainError(422,'INVALID_MONTH','Mês inválido');
  const store=req.authContext!.storeId,month=req.query.month+'-01';
  const row=await db.query<{
   gross:string;cost:string;returned_cost:string;unknown:string;cash_returns:string;external_returns:string;
   expenses:string;tax:string;commissions:string;reversed_commissions:string;
  }>(`SELECT
   (SELECT coalesce(sum(gross_cents),0)::text FROM retail_revenue_events WHERE store_id=$1
    AND occurred_at>=($2::date::timestamp AT TIME ZONE st.timezone)
    AND occurred_at<(($2::date+interval '1 month') AT TIME ZONE st.timezone)) AS gross,
   (SELECT coalesce(sum(l.quantity*l.cost_unit_cents),0)::text FROM sale_lines l
    JOIN sales s ON s.id=l.sale_id AND s.store_id=l.store_id WHERE s.store_id=$1
    AND s.created_at>=($2::date::timestamp AT TIME ZONE st.timezone)
    AND s.created_at<(($2::date+interval '1 month') AT TIME ZONE st.timezone)) AS cost,
   ((SELECT coalesce(sum(r.quantity*l.cost_unit_cents),0) FROM cash_return_lines r
      JOIN sale_lines l ON l.id=r.sale_line_id AND l.store_id=r.store_id
      JOIN cash_sale_returns cr ON cr.id=r.return_id AND cr.store_id=r.store_id
      WHERE r.store_id=$1 AND r.disposition='resellable'
       AND cr.created_at>=($2::date::timestamp AT TIME ZONE st.timezone)
       AND cr.created_at<(($2::date+interval '1 month') AT TIME ZONE st.timezone))
     +(SELECT coalesce(sum(l.cost_unit_cents*x.quantity),0)
      FROM retail_after_sale_lines x JOIN sale_lines l ON l.id=x.sale_line_id AND l.store_id=x.store_id
      JOIN retail_after_sales a ON a.id=x.operation_id AND a.store_id=x.store_id
      WHERE x.store_id=$1 AND x.disposition='resellable'
       AND a.created_at>=($2::date::timestamp AT TIME ZONE st.timezone)
       AND a.created_at<(($2::date+interval '1 month') AT TIME ZONE st.timezone)))::text AS returned_cost,
   (SELECT count(*)::text FROM sale_lines l JOIN sales s ON s.id=l.sale_id AND s.store_id=l.store_id
    WHERE s.store_id=$1 AND l.cost_unit_cents IS NULL
    AND s.created_at>=($2::date::timestamp AT TIME ZONE st.timezone)
    AND s.created_at<(($2::date+interval '1 month') AT TIME ZONE st.timezone)) AS unknown,
   (SELECT coalesce(sum(amount_cents),0)::text FROM cash_sale_returns WHERE store_id=$1
    AND created_at>=($2::date::timestamp AT TIME ZONE st.timezone)
    AND created_at<(($2::date+interval '1 month') AT TIME ZONE st.timezone)) AS cash_returns,
   (SELECT coalesce(sum(amount_cents),0)::text FROM retail_after_sales WHERE store_id=$1
    AND created_at>=($2::date::timestamp AT TIME ZONE st.timezone)
    AND created_at<(($2::date+interval '1 month') AT TIME ZONE st.timezone)) AS external_returns,
   (SELECT coalesce(sum(amount_cents),0)::text FROM operating_expenses WHERE store_id=$1 AND voided_at IS NULL
    AND lower(category)<>'tributos' AND occurred_on >= $2::date AND occurred_on<($2::date+interval '1 month')) AS expenses,
   (SELECT coalesce(sum(amount_cents),0)::text FROM operating_expenses WHERE store_id=$1 AND voided_at IS NULL
    AND lower(category)='tributos' AND occurred_on >= $2::date AND occurred_on<($2::date+interval '1 month')) AS tax,
   (SELECT coalesce(sum(e.amount_cents),0)::text FROM retail_commission_entries e
    WHERE e.store_id=$1 AND e.created_at>=($2::date::timestamp AT TIME ZONE st.timezone)
    AND e.created_at<(($2::date+interval '1 month') AT TIME ZONE st.timezone)) AS commissions,
   (SELECT coalesce(sum(e.amount_cents),0)::text FROM retail_commission_reversals e
    WHERE e.store_id=$1 AND e.created_at>=($2::date::timestamp AT TIME ZONE st.timezone)
    AND e.created_at<(($2::date+interval '1 month') AT TIME ZONE st.timezone)) AS reversed_commissions
   FROM stores st WHERE st.id=$1`,[store,month]);
  if(!row.rowCount)throw new DomainError(404,'STORE_NOT_FOUND','Loja não encontrada');
  const r=row.rows[0],sum=dreTotals({gross_cents:Number(r.gross),
   returns_cents:Number(r.cash_returns)+Number(r.external_returns),
   cost_cents:Number(r.cost)-Number(r.returned_cost),
   expenses_cents:Number(r.expenses),tax_cents:Number(r.tax),
   commissions_cents:Number(r.commissions)-Number(r.reversed_commissions),
   unknown_cost_lines:Number(r.unknown)});
  return {month:req.query.month, ...sum, gross_cents:Number(r.gross),
   returns_cents:Number(r.cash_returns)+Number(r.external_returns),
   cost_cents:Number(r.cost)-Number(r.returned_cost),expenses_cents:Number(r.expenses),
   tax_cents:Number(r.tax),commissions_cents:Number(r.commissions)-Number(r.reversed_commissions),
   note:sum.complete?'DRE gerencial estimada, não fiscal.':'DRE incompleta: custo de peças não informado; não interprete o resultado como lucro real.'};
 });
}
