import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from '../src/app.ts';
import {hashPassword,issueSession} from '../src/security.ts';

const connection=process.env.TEST_DATABASE_URL;
type Res={statusCode:number;body:string;json:()=>any};

test('correções de regras: usuários, desconto, devolução dividida, reservas, caixa, despesas e clientes',{
 skip:!connection&&'Requer PostgreSQL QA'},async()=>{
 const db=new Pool({connectionString:connection!}),app=buildApp(db);
 try{
  const store=(await db.query<{id:string}>(`INSERT INTO stores(name) VALUES($1) RETURNING id::text`,['Loja Regras '+randomUUID().slice(0,6)])).rows[0].id;
  const manager=(await db.query<{id:string}>(`INSERT INTO users(login,password_hash) VALUES($1,$2) RETURNING id::text`,
   ['gestor-'+randomUUID().slice(0,8),await hashPassword('Senha-Gestor-QA-2026')])).rows[0].id;
  await db.query("INSERT INTO user_store_roles(user_id,store_id,role_code) VALUES($1,$2,'manager')",[manager,store]);
  const session=issueSession();
  await db.query(`INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')`,[manager,session.tokenHash]);
  const as=(token:string)=>async(method:'GET'|'POST'|'PUT',url:string,payload?:unknown,key?:string):Promise<Res>=>
   await app.inject({method,url,headers:{authorization:'Bearer '+token,'x-store-id':store,
    ...(method==='GET'?{}:{'idempotency-key':key??randomUUID()})},...(payload===undefined?{}:{payload:payload as object})});
  const req=as(session.token);
  const ok=(code:number,res:Res)=>{assert.equal(res.statusCode,code,res.body);return res.json();};

  // 1. Usuários: o gestor cria um caixa, que consegue entrar e não administra usuários.
  const login='caixa-'+randomUUID().slice(0,6);
  const cashier=ok(201,await req('POST','/v1/management/users',{login,display_name:'Ana do Caixa',password:'Senha-Caixa-2026!',roles:['cashier']}));
  ok(409,await req('POST','/v1/management/users',{login,password:'Senha-Caixa-2026!',roles:['cashier']}));
  const signIn=ok(200,await app.inject({method:'POST',url:'/v1/auth/sessions',payload:{login,password:'Senha-Caixa-2026!'}}));
  const cashierReq=as(signIn.token);
  ok(403,await cashierReq('GET','/v1/management/users'));
  const users=ok(200,await req('GET','/v1/management/users'));
  assert.equal(users.items.length,2);
  const lastManager=await req('PUT','/v1/management/users/'+manager,{status:'blocked'});
  assert.equal(lastManager.statusCode,409);assert.equal(lastManager.json().code,'LAST_MANAGER');
  ok(200,await req('PUT','/v1/management/store-profile',{name:'Boutique Regras',document:'12.345.678/0001-90',
   address:'Rua das Flores, 100',phone:'(11) 4000-0000',max_cashier_discount_bps:1000}));

  // Catálogo com custo; preço zero é recusado.
  ok(400,await req('POST','/v1/catalog/products',{name:'Grátis',category:'Teste',variants:[{sku:'ZERO-'+randomUUID().slice(0,6),color:'A',size:'U',price_cents:0}]}));
  const sku=()=>'RG-'+randomUUID().slice(0,8);
  const product=ok(201,await req('POST','/v1/catalog/products',{name:'Vestido Regras',category:'Feminino',variants:[
   {sku:sku(),color:'Azul',size:'M',price_cents:10000,cost_cents:4000},
   {sku:sku(),color:'Azul',size:'G',price_cents:10000}]}));
  const [vm,vg]=product.variants.map((v:{id:string})=>v.id);
  for(const v of [vm,vg])ok(201,await req('POST','/v1/stock/receipts',{variant_id:v,reference_id:randomUUID(),quantity:10,
   note:'Estoque inicial do teste de regras',...(v===vg?{unit_cost_cents:4500}:{})}));

  const cash=ok(201,await cashierReq('POST','/v1/cash-sessions',{terminal_code:'REGRAS-01',opening_cents:5000}));
  const line=(v:string,qty:number,extra={})=>({variant_id:v,quantity:qty,expected_price_cents:10000,expected_price_revision:1,...extra});

  // 2. Desconto: até 10% o caixa aplica; acima disso só o gestor; motivo é obrigatório.
  const quote=ok(200,await cashierReq('POST','/v1/sales/quotes',{lines:[{variant_id:vm,quantity:2}],discount_cents:3000}));
  assert.equal(quote.total_cents,17000);assert.equal(quote.discount_requires_manager,true);
  const tooMuch=await cashierReq('POST','/v1/sales',{cash_session_id:cash.id,lines:[line(vm,2)],discount_cents:3000,
   discount_reason:'Cliente fiel',payments:[{method:'cash',amount_cents:17000,confirmed:true}]});
  assert.equal(tooMuch.statusCode,403,tooMuch.body);assert.equal(tooMuch.json().code,'DISCOUNT_LIMIT');
  const noReason=await cashierReq('POST','/v1/sales',{cash_session_id:cash.id,lines:[line(vm,2)],discount_cents:2000,
   payments:[{method:'cash',amount_cents:18000,confirmed:true}]});
  assert.equal(noReason.json().code,'DISCOUNT_REASON');
  // Venda 1: 3 peças com R$ 10,00 de desconto, paga com Pix e dinheiro (troco de R$ 5,00).
  const sale1=ok(201,await cashierReq('POST','/v1/sales',{cash_session_id:cash.id,lines:[line(vm,3)],discount_cents:1000,
   discount_reason:'Pagamento à vista',payments:[
    {method:'pix_manual',amount_cents:15000,confirmed:true,external_reference:'123456'},
    {method:'cash',amount_cents:19000,confirmed:true}]}));
  assert.equal(sale1.total_cents,29000);assert.equal(sale1.discount_cents,1000);assert.equal(sale1.change_cents,5000);
  // Referência de cartão/Pix repetida não bloqueia outra venda.
  const sale2=ok(201,await req('POST','/v1/sales',{cash_session_id:cash.id,lines:[line(vg,1)],
   payments:[{method:'pix_manual',amount_cents:10000,confirmed:true,external_reference:'123456'}]}));
  const lines1=(await db.query<{line_total_cents:string;discount_cents:string;cost_unit_cents:string}>(
   'SELECT line_total_cents::text,discount_cents::text,cost_unit_cents::text FROM sale_lines WHERE sale_id=$1',[sale1.id])).rows;
  assert.deepEqual(lines1,[{line_total_cents:'29000',discount_cents:'1000',cost_unit_cents:'4000'}]);
  const cost2=(await db.query('SELECT cost_unit_cents::text AS c FROM sale_lines WHERE sale_id=$1',[sale2.id])).rows[0].c;
  assert.equal(cost2,'4500');

  // Comprovante com os dados da loja e nomes legíveis.
  const receipt=await req('GET','/v1/sales/'+sale1.id+'/receipt');
  assert.equal(receipt.statusCode,200);
  assert.match(receipt.body,/BOUTIQUE REGRAS/);assert.match(receipt.body,/CNPJ\/CPF: 12\.345\.678\/0001-90/);
  assert.match(receipt.body,/DESCONTO -R\$\s10,00 \(Pagamento à vista\)/);assert.match(receipt.body,/^PIX R\$/m);
  assert.doesNotMatch(receipt.body,/pix_manual|cash /);

  // 4. Devolução de venda mista: o reembolso respeita o que foi pago em cada meio.
  const saleLine=(await db.query<{id:string}>('SELECT id::text FROM sale_lines WHERE sale_id=$1',[sale1.id])).rows[0].id;
  const preview=ok(200,await req('POST','/v1/management/after-sales/refund/preview',{sale_number:sale1.sale_number,
   items:[{sale_line_id:saleLine,quantity:2,condition:'resellable'}]}));
  assert.equal(preview.amount_cents,19333);assert.equal(preview.refundable.cash,14000);
  assert.deepEqual(preview.suggested,[{method:'pix_manual',amount_cents:15000},{method:'cash',amount_cents:4333}]);
  const wrongTotal=await req('POST','/v1/management/after-sales/refund',{sale_number:sale1.sale_number,reason:'Cliente desistiu das peças',
   cash_session_id:cash.id,items:[{sale_line_id:saleLine,quantity:2,condition:'resellable'}],parts:[{method:'cash',amount_cents:19333}]});
  assert.equal(wrongTotal.json().code,'REFUND_PAYMENT_MISMATCH');
  const refund=ok(201,await req('POST','/v1/management/after-sales/refund',{sale_number:sale1.sale_number,reason:'Cliente desistiu das peças',
   cash_session_id:cash.id,items:[{sale_line_id:saleLine,quantity:1,condition:'resellable'},].concat([]),
   parts:[{method:'pix_manual',amount_cents:9666,external_reference:'EST-PIX-1'}]}));
  assert.equal(refund.status,'partially_returned');
  ok(201,await req('POST','/v1/management/after-sales/refund',{sale_number:sale1.sale_number,reason:'Peça com defeito na costura',
   cash_session_id:cash.id,items:[{sale_line_id:saleLine,quantity:2,condition:'quarantine'}],
   parts:[{method:'pix_manual',amount_cents:5334,external_reference:'EST-PIX-2'},{method:'cash',amount_cents:14000}]}));
  const balance=(await db.query('SELECT on_hand::text,quarantined::text FROM stock_balances WHERE variant_id=$1',[vm])).rows[0];
  assert.deepEqual(balance,{on_hand:'8',quarantined:'2'});
  ok(200,await req('POST','/v1/stock/quarantine/resolve',{variant_id:vm,quantity:1,action:'release',reason:'Peça consertada pela costureira'}));
  ok(200,await req('POST','/v1/stock/quarantine/resolve',{variant_id:vm,quantity:1,action:'discard',reason:'Sem conserto, descartada'}));
  const after=(await db.query('SELECT on_hand::text,quarantined::text FROM stock_balances WHERE variant_id=$1',[vm])).rows[0];
  assert.deepEqual(after,{on_hand:'9',quarantined:'0'});
  assert.equal((await req('GET','/v1/sales/'+sale1.id)).json().status,'returned');

  // Crediário: devolver a peça abate as parcelas em aberto.
  const customer=ok(201,await req('POST','/v1/management/customers',{name:'Cliente Crediário Regras',phone:'11988887777',loyalty_opt_in:true}));
  ok(200,await req('POST','/v1/management/customers/'+customer.id+'/credit-limit',{enabled:true,credit_limit_cents:100000}));
  const credit=ok(201,await req('POST','/v1/sales',{cash_session_id:cash.id,customer_id:customer.id,lines:[line(vg,2)],
   payments:[{method:'store_credit',amount_cents:20000,confirmed:true}],
   credit_installments:[{amount_cents:10000,due_on:'2027-01-10'},{amount_cents:10000,due_on:'2027-02-10'}]}));
  const noPoints=await db.query("SELECT 1 FROM retail_loyalty_events WHERE sale_id=$1 AND kind='earn'",[credit.id]);
  assert.equal(noPoints.rowCount,0,'crediário só rende pontos no pagamento');
  const anonymize=await req('POST','/v1/management/customers/'+customer.id+'/anonymize');
  assert.equal(anonymize.json().code,'CUSTOMER_HAS_DEBT');
  const creditLine=(await db.query<{id:string}>('SELECT id::text FROM sale_lines WHERE sale_id=$1',[credit.id])).rows[0].id;
  ok(201,await req('POST','/v1/management/after-sales/refund',{sale_number:credit.sale_number,reason:'Cliente devolveu uma peça',
   items:[{sale_line_id:creditLine,quantity:1,condition:'resellable'}],parts:[{method:'store_credit',amount_cents:10000}]}));
  const accounts=(await db.query<{amount_cents:string;cancelled:boolean}>(`SELECT amount_cents::text,cancelled_at IS NOT NULL AS cancelled
   FROM retail_accounts WHERE source_id=$1 ORDER BY due_on`,[credit.id])).rows;
  assert.deepEqual(accounts,[{amount_cents:'10000',cancelled:false},{amount_cents:'10000',cancelled:true}]);

  // 6 e 7. Reserva de balcão vence sozinha; reserva pode ser vendida diretamente.
  const hold=ok(201,await req('POST','/v1/stock/holds',{variant_id:vg,quantity:7,hours:2}));
  const blocked=await req('POST','/v1/sales',{cash_session_id:cash.id,lines:[line(vg,7)],payments:[{method:'cash',amount_cents:70000,confirmed:true}]});
  assert.equal(blocked.json().code,'OUT_OF_STOCK');
  ok(201,await req('POST','/v1/sales',{cash_session_id:cash.id,lines:[line(vg,7)],stock_hold_ids:[hold.id],
   payments:[{method:'cash',amount_cents:70000,confirmed:true}]}));
  ok(201,await req('POST','/v1/stock/receipts',{variant_id:vg,reference_id:randomUUID(),quantity:3,note:'Reposição para testar validade'}));
  const old=ok(201,await req('POST','/v1/stock/holds',{variant_id:vg,quantity:2}));
  await db.query("UPDATE stock_holds SET expires_at=now()-interval '1 minute' WHERE id=$1",[old.id]);
  const holds=ok(200,await req('GET','/v1/stock/holds'));
  assert.equal(holds.holds.some((h:{id:string})=>h.id===old.id),false);
  assert.equal((await db.query('SELECT reserved::text FROM stock_balances WHERE variant_id=$1',[vg])).rows[0].reserved,'0');

  // 3. Faturamento: todas as telas descontam trocas e estornos, não só devolução em dinheiro.
  const month=new Date().toLocaleDateString('sv-SE',{timeZone:'America/Sao_Paulo'}).slice(0,7);
  const result=ok(200,await req('GET','/v1/management/operational-result?month='+month));
  const dre=ok(200,await req('GET','/v1/management/dre?month='+month));
  assert.equal(result.gross_cents,dre.gross_cents);assert.equal(result.refunds_cents,dre.returns_cents);
  assert.equal(result.refunds_cents,9666+19334+10000);
  const summary=ok(200,await req('GET','/v1/management/sales-summary'));
  assert.equal(summary.days.reduce((n:number,d:{refunded_cents:string})=>n+Number(d.refunded_cents),0),result.refunds_cents);

  // 11. Despesa pode ser corrigida e estornada; a estornada sai do resultado.
  const expense=ok(201,await req('POST','/v1/management/expenses',{amount_cents:5000,category:'Energia',description:'Conta de luz',occurred_on:month+'-05'}));
  ok(200,await req('PUT','/v1/management/expenses/'+expense.id,{amount_cents:5500,category:'Energia',description:'Conta de luz corrigida',occurred_on:month+'-05'}));
  assert.equal(ok(200,await req('GET','/v1/management/operational-result?month='+month)).expenses_cents,5500);
  ok(200,await req('POST','/v1/management/expenses/'+expense.id+'/void',{reason:'Lançada em duplicidade'}));
  assert.equal(ok(200,await req('GET','/v1/management/operational-result?month='+month)).expenses_cents,0);

  // Busca de clientes além dos 100 primeiros.
  for(let i=0;i<3;i++)ok(201,await req('POST','/v1/management/customers',{name:'Zélia Busca '+i}));
  const found=ok(200,await req('GET','/v1/management/customers?q=z%C3%A9lia&limit=2'));
  assert.equal(found.items.length,2);assert.equal(found.total,3);
  assert.equal(ok(200,await req('GET','/v1/management/customers?q=88887777')).items[0].name,'Cliente Crediário Regras');

  // 9. Compra de grade inteira com conta a pagar que não vira despesa do mês.
  const supplier=ok(201,await req('POST','/v1/management/suppliers',{name:'Confecção Regras'}));
  const batch=ok(201,await req('POST','/v1/management/purchases/batch',{supplier_id:supplier.id,
   lines:[{variant_id:vm,quantity:5,unit_cost_cents:4000},{variant_id:vg,quantity:5,unit_cost_cents:4200}],payable:{due_on:'2027-01-30'}}));
  assert.equal(batch.order_ids.length,2);assert.equal(batch.total_cents,41000);
  const payable=(await db.query('SELECT expense_record_id FROM retail_accounts WHERE id=$1',[batch.payable_id])).rows[0];
  assert.equal(payable.expense_record_id,null);

  // 12. Histórico e resumo do caixa por forma de pagamento.
  const sum=ok(200,await req('GET','/v1/cash-sessions/'+cash.id+'/summary'));
  assert.equal(sum.sales.discount_cents,1000);
  assert.ok(sum.payments.some((p:{method:string})=>p.method==='pix_manual'));
  assert.ok(sum.refunds.some((p:{method:string;amount_cents:number})=>p.method==='cash'&&p.amount_cents===14000));
  const closed=ok(200,await cashierReq('POST','/v1/cash-sessions/'+cash.id+'/close',{counted_cash_cents:sum.expected_cash_cents}));
  assert.equal(closed.difference_cents,0);
  const history=ok(200,await req('GET','/v1/cash-sessions'));
  assert.equal(history.items[0].id,cash.id);assert.equal(history.items[0].opened_by,'Ana do Caixa');
  assert.ok(cashier.id);
 }finally{await app.close();await db.end();}
});
