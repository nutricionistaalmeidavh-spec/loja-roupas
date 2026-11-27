import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {ApiError,headers,jsonRequest} from './api-client.ts';
import type {Session} from './api-client.ts';
import {requestId} from './request-id.ts';

type Account={id:string;kind:'payable'|'receivable';description:string;amount_cents:string;settled_cents:string;due_on:string};
type Credit={id:string;name:string;enabled:boolean|null;credit_limit_cents:string|null;outstanding_cents:string};
type Commission={seller_id:string;login:string;rate_bps:number;accrued_cents:string;paid_cents:string;held_cents?:string};
type Dre={month:string;gross_cents:number;returns_cents:number;cost_cents:number;expenses_cents:number;
 commissions_cents:number;tax_cents:number;net_revenue_cents:number;gross_profit_cents:number;
 operating_result_cents:number;complete:boolean;unknown_cost_lines:number;note:string};
const brl=(value:number|string)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)/100);
const date=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
function cents(value:string){
 const v=value.trim().replace(',','.');
 if(!/^\d+(?:\.\d{1,2})?$/.test(v))throw Error('Informe valor em reais com até duas casas decimais');
 const n=Math.round(Number(v)*100);
 if(!Number.isSafeInteger(n)||n<1)throw Error('Valor inválido');
 return n;
}
export function RetailLedger({session,cashId}:{session:Session;cashId:string|null}){
 const [accounts,setAccounts]=useState<Account[]>([]),[credit,setCredit]=useState<Credit[]>([]),
 [commissions,setCommissions]=useState<Commission[]>([]),[dre,setDre]=useState<Dre|null>(null),
 [month,setMonth]=useState(date().slice(0,7)),[revision,setRevision]=useState(0),
 [notice,setNotice]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const pending=useRef(new Map<string,string>());
 useEffect(()=>{
  const ctrl=new AbortController();setError('');
  const init={headers:headers(session),signal:ctrl.signal};
  void Promise.all([
   jsonRequest<{items:Account[]}>('/v1/management/accounts',init,fetch),
   jsonRequest<{items:Credit[]}>('/v1/management/credit-limits',init,fetch),
   jsonRequest<{items:Commission[]}>('/v1/management/commissions',init,fetch),
   jsonRequest<Dre>('/v1/management/dre?month='+encodeURIComponent(month),init,fetch)
  ]).then(([a,c,s,d])=>{if(!ctrl.signal.aborted){setAccounts(a.items);setCredit(c.items);setCommissions(s.items);setDre(d);}})
   .catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Erro ao carregar gestão financeira');});
  return ()=>ctrl.abort();
 },[session,month,revision]);
 async function write(path:string,body:object,message:string){
  if(busy)return;
  const payload=JSON.stringify(body),signature=path+payload,key=pending.current.get(signature)||requestId();
  pending.current.set(signature,key);setBusy(true);setError('');setNotice('');
  try{
   await jsonRequest(path,{method:'POST',headers:{...headers(session,key),'content-type':'application/json'},body:payload},fetch);
   pending.current.delete(signature);setRevision(x=>x+1);setNotice(message);
  }catch(e){
   if(e instanceof ApiError&&e.status>=400&&e.status<500)pending.current.delete(signature);
   setError(e instanceof Error?e.message:'Falha no lançamento. Verifique o histórico antes de repetir.');
  }finally{setBusy(false);}
 }
 function createAccount(event:FormEvent<HTMLFormElement>){
  event.preventDefault();const f=event.currentTarget,form=new FormData(f);
  try{
   const kind=String(form.get('kind'));const description=String(form.get('description')).trim();
   const amount_cents=cents(String(form.get('amount'))),due_on=String(form.get('due_on'));
   const category=String(form.get('category')).trim();
   void write('/v1/management/accounts',{kind,description,amount_cents,due_on,
    ...(kind==='payable'?{category:category||'Despesas operacionais',recognized_on:due_on}:{})},
    kind==='payable'?'Conta a pagar e despesa de competência registradas.':'Conta a receber criada.');
  }catch(e){setError(e instanceof Error?e.message:'Valor inválido');}
 }
 function settle(event:FormEvent<HTMLFormElement>,id:string){
  event.preventDefault();const form=new FormData(event.currentTarget);
  try{
   const amount_cents=cents(String(form.get('amount')));
   const method=String(form.get('method')),external_reference=String(form.get('reference')).trim();
   const cash_session_id=cashId;
   void write('/v1/management/accounts/'+id+'/settlements',
    {amount_cents,method,...(method==='cash'?{cash_session_id}:{external_reference})},
    'Recebimento ou pagamento registrado.').then(()=>{});
  }catch(e){setError(e instanceof Error?e.message:'Valor inválido');}
 }
 return <section className="management-section" aria-label="Gestão financeira completa">
  <h2>Contas, DRE, crediário e comissões</h2>
  <p>Os lançamentos ficam neste computador. Pix e cartão são conferidos na maquininha ou no banco. Os indicadores não substituem contabilidade ou documentos fiscais.</p>
  {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <h3>DRE gerencial</h3>
  <label>Mês <input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label>
  {dre&&<><div className="management-kpis">
   <div><span>Faturamento bruto</span><strong>{brl(dre.gross_cents)}</strong></div>
   <div><span>Devoluções</span><strong>{brl(dre.returns_cents)}</strong></div>
   <div><span>CMV conhecido</span><strong>{brl(dre.cost_cents)}</strong></div>
   <div><span>Receita líquida</span><strong>{brl(dre.net_revenue_cents)}</strong></div>
   <div><span>Despesas</span><strong>{brl(dre.expenses_cents)}</strong></div>
   <div><span>Comissões</span><strong>{brl(dre.commissions_cents)}</strong></div>
   <div><span>Tributos informados</span><strong>{brl(dre.tax_cents)}</strong></div>
   <div><span>Resultado gerencial estimado</span><strong>{brl(dre.operating_result_cents)}</strong></div>
  </div><p role="status">{dre.complete?'Custos das vendas registrados.':'DRE incompleta: '+dre.unknown_cost_lines+' linhas de venda sem custo registrado.'} {dre.note}</p></>}
  <h3>Contas a pagar e a receber</h3>
  <p>Contas a pagar também geram despesa na competência informada (padrão: vencimento), uma única vez. Não duplique manualmente a mesma despesa no painel anterior.</p>
  <form className="management-form" onSubmit={createAccount}>
   <label>Tipo <select name="kind"><option value="payable">A pagar</option><option value="receivable">A receber</option></select></label>
   <label>Descrição <input name="description" required minLength={3} maxLength={240}/></label>
   <label>Categoria da despesa (somente contas a pagar)
    <input name="category" maxLength={80} placeholder="Aluguel, Tributos, Frete…"/></label>
   <label>Valor (R$) <input name="amount" inputMode="decimal" required placeholder="150,00"/></label>
   <label>Vencimento <input name="due_on" type="date" defaultValue={date()} required/></label>
   <button className="primary-action" disabled={busy}>Criar conta</button>
  </form>
  <div className="management-table-scroll" role="region" tabIndex={0} aria-label="Contas em aberto">
   <table><thead><tr><th>Tipo</th><th>Descrição</th><th>Vencimento</th><th>Em aberto</th><th>Baixa</th></tr></thead>
    <tbody>{accounts.map(a=>{
     const remaining=Number(a.amount_cents)-Number(a.settled_cents);
     return <tr key={a.id}><td>{a.kind==='payable'?'Pagar':'Receber'}</td>
     <td>{a.description}</td><td>{a.due_on}</td><td>{brl(remaining)}</td>
     <td>{remaining>0?<form className="management-form" onSubmit={e=>settle(e,a.id)}>
      <input name="amount" aria-label="Valor da baixa" inputMode="decimal" required placeholder="Valor R$"/>
      <select name="method" aria-label="Meio de pagamento">
       <option value="pix_manual">Pix externo conferido</option><option value="card_external">Cartão externo</option>
       <option value="bank_transfer">Transferência bancária</option>
       {cashId&&<option value="cash">Dinheiro no caixa aberto</option>}
      </select><input name="reference" aria-label="Comprovante externo" placeholder="Referência Pix/cartão"/>

      <button type="submit" disabled={busy}>Registrar baixa</button>
     </form>:<span>Quitada</span>}</td></tr>;
    })}</tbody></table>
  </div>
  <h3>Limites do crediário</h3>
  <p>O gestor define o limite antes de autorizar uma venda a prazo.</p>
  <div className="management-table-scroll" role="region" tabIndex={0}>
   <table><thead><tr><th>Cliente</th><th>Limite</th><th>Dívida aberta</th><th>Autorização</th></tr></thead>
   <tbody>{credit.map(c=><tr key={c.id}><td>{c.name}</td><td>{brl(c.credit_limit_cents||0)}</td>
    <td>{brl(c.outstanding_cents)}</td><td>
    <form className="management-form" onSubmit={e=>{
     e.preventDefault();const f=new FormData(e.currentTarget);
     try{const limit=String(f.get('limit')),credit_limit_cents=limit.trim()==='0'?0:cents(limit);
      void write('/v1/management/customers/'+c.id+'/credit-limit',
       {enabled:f.get('enabled')==='on',credit_limit_cents},'Limite atualizado.');
     }catch(err){setError(err instanceof Error?err.message:'Limite inválido');}
    }}><input name="limit" inputMode="decimal" aria-label={'Limite de '+c.name} placeholder="Valor R$" defaultValue={(Number(c.credit_limit_cents||0)/100).toFixed(2)}/>
     <label><input type="checkbox" name="enabled" defaultChecked={Boolean(c.enabled)}/> Ativo</label>
     <button disabled={busy}>Salvar</button></form>
   </td></tr>)}</tbody></table>
  </div>
  <h3>Comissões por vendedor</h3>
  <div className="management-table-scroll" role="region" tabIndex={0}>
   <table><thead><tr><th>Operador</th><th>Comissão gerada</th><th>Pago</th><th>Aguardando crediário</th><th>Liberado para pagar</th><th>Regra e baixa</th></tr></thead>
   <tbody>{commissions.map(s=><tr key={s.seller_id}><td>{s.login}</td><td>{brl(s.accrued_cents)}</td><td>{brl(s.paid_cents)}</td>
    <td>{brl(Number(s.held_cents??0))}</td>
    <td>{brl(Math.max(0,Number(s.accrued_cents)-Number(s.paid_cents)-Number(s.held_cents??0)))}</td><td>
    <form className="management-form" onSubmit={e=>{
     e.preventDefault();const v=String(new FormData(e.currentTarget).get('rate')||'').replace(',','.');
     const rate=Number(v);
     if(!Number.isFinite(rate)||rate<0||rate>100||!Number.isInteger(rate*100)){setError('Taxa deve estar entre 0 e 100% com duas casas decimais.');return;}
     void write('/v1/management/commissions/'+s.seller_id+'/rule',{rate_bps:Math.round(rate*100)},'Regra de comissão atualizada.');
    }}><input name="rate" aria-label={'Comissão de '+s.login} defaultValue={(s.rate_bps/100).toFixed(2)} inputMode="decimal"/>
     <button disabled={busy}>Definir %</button></form>
    {Number(s.accrued_cents)-Number(s.paid_cents)-Number(s.held_cents??0)>0&&<form className="management-form" onSubmit={e=>{
     e.preventDefault();const f=new FormData(e.currentTarget);
     try{
      const amount_cents=cents(String(f.get('amount'))),method=String(f.get('method'));
      const ref=String(f.get('reference')).trim();
      if(method==='cash'&&!cashId){setError('Caixa precisa estar aberto para pagar em dinheiro');return;}
      void write('/v1/management/commissions/'+s.seller_id+'/payout',
       {amount_cents,method,...(method==='cash'?{cash_session_id:cashId}:{external_reference:ref})},
       'Comissão liquidada e auditada.');
     }catch(err){setError(err instanceof Error?err.message:'Valor inválido');}
    }}>
     <input name="amount" aria-label={'Liquidar comissão de '+s.login} placeholder="Valor R$" required inputMode="decimal"/>
     <select name="method" aria-label="Forma de pagamento de comissão">
      <option value="bank_transfer">Transferência</option>{cashId&&<option value="cash">Caixa aberto</option>}
     </select>
     <input name="reference" aria-label="Referência da transferência" placeholder="Comprovante externo"/>
     <button disabled={busy}>Pagar comissão</button>
    </form>}
   </td></tr>)}</tbody></table>
  </div>
 </section>;
}
