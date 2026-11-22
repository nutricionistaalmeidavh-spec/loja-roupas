import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {ApiError,headers,jsonRequest} from './api-client.ts';
import type {Session} from './api-client.ts';
import {requestId} from './request-id.ts';
type Customer={id:string;name:string;phone:string|null;email:string|null;marketing_consent:boolean;loyalty_opt_in:boolean};
type Loyalty={customer_id:string;points:number;credit_cents:number};
const brl=(n:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
export function ManagementCustomers({session}:{session:Session}){
 const [items,setItems]=useState<Customer[]>([]),[selected,setSelected]=useState<Customer|null>(null),
 [points,setPoints]=useState<Loyalty|null>(null),[redeem,setRedeem]=useState(100),
 [marketing,setMarketing]=useState(false),[loyalty,setLoyalty]=useState(false),
 [error,setError]=useState(''),[notice,setNotice]=useState(''),
 [busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 const pending=useRef(new Map<string,string>());
 useEffect(()=>{
  let alive=true;
  void jsonRequest<{items:Customer[]}>('/v1/management/customers',{headers:headers(session)},fetch)
   .then(r=>{if(alive)setItems(r.items);})
   .catch(e=>{if(alive)setError(e instanceof Error?e.message:'Erro ao buscar clientes');});
  return ()=>{alive=false;};
 },[session,revision]);
 useEffect(()=>{
  if(!selected){setPoints(null);return;}
  const ctrl=new AbortController();
  void jsonRequest<Loyalty>('/v1/management/customers/'+selected.id+'/loyalty',
   {headers:headers(session),signal:ctrl.signal},fetch)
   .then(p=>{if(!ctrl.signal.aborted)setPoints(p);})
   .catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Erro ao consultar fidelidade');});
  return ()=>ctrl.abort();
 },[selected,session,revision]);
 async function write(path:string,body:object,message:string){
  if(busy)return false;
  const payload=JSON.stringify(body),signature=path+payload;
  const key=pending.current.get(signature)||requestId();
  pending.current.set(signature,key);
  setBusy(true);setError('');setNotice('');
  try{
   await jsonRequest(path,{method:'POST',headers:{...headers(session,key),'content-type':'application/json'},
    body:payload},fetch);
   pending.current.delete(signature);setRevision(n=>n+1);setNotice(message);
   return true;
  }catch(e){
   if(e instanceof ApiError&&e.status>=400&&e.status<500)pending.current.delete(signature);
   setError(e instanceof Error?e.message:'Falha na operação. Confira os registros antes de repetir.');
   return false;
  }finally{setBusy(false);}
 }
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const f=e.currentTarget,form=new FormData(f);
  const ok=await write('/v1/management/customers',{
   name:String(form.get('name')).trim(),phone:String(form.get('phone')).trim()||null,
   email:String(form.get('email')).trim()||null,marketing_consent:form.get('marketing')==='on',
   loyalty_opt_in:form.get('loyalty')==='on'
  },'Cliente cadastrado.');
  if(ok)f.reset();
 }
 async function anonymize(c:Customer){
  if(!window.confirm('Anonimizar definitivamente dados pessoais de '+c.name+'?'))return;
  const ok=await write('/v1/management/customers/'+c.id+'/anonymize',{},'Cliente anonimizado.');
  if(ok&&selected?.id===c.id)setSelected(null);
 }
 function showCustomer(c:Customer){
  setSelected(c);setPoints(null);setMarketing(c.marketing_consent);setLoyalty(c.loyalty_opt_in);
  setError('');setNotice('');
 }
 async function changeConsent(){
  if(!selected)return;
  const ok=await write('/v1/management/customers/'+selected.id+'/consents',{
   marketing_consent:marketing,loyalty_opt_in:loyalty
  },'Consentimentos atualizados e auditados.');
  if(ok)setSelected({...selected,marketing_consent:marketing,loyalty_opt_in:loyalty});
 }
 async function redeemPoints(e:FormEvent){
  e.preventDefault();if(!selected)return;
  await write('/v1/management/customers/'+selected.id+'/loyalty/redeem',
   {points:redeem},'Pontos convertidos em crédito próprio para uso no PDV.');
 }
 return <section className="management-section" aria-label="Clientes e fidelidade">
  <h2>Clientes e fidelidade</h2>
  <p>Cadastro e pontos locais. Marketing é opt-in separado da fidelidade. Nenhuma mensagem é enviada automaticamente.</p>
  {notice&&<p role="status">{notice}</p>}{error&&<p className="error" role="alert">{error}</p>}
  <form className="management-form" onSubmit={e=>void submit(e)}>
   <label>Nome<input name="name" minLength={2} maxLength={120} required/></label>
   <label>Telefone (opcional)<input name="phone" type="tel" maxLength={24}/></label>
   <label>E-mail (opcional)<input name="email" type="email" maxLength={254}/></label>
   <label><input type="checkbox" name="marketing"/> Autoriza comunicação comercial</label>
   <label><input type="checkbox" name="loyalty"/> Adere ao programa de pontos da loja</label>
   <button className="primary-action" disabled={busy}>Cadastrar cliente</button>
  </form>
  <h3>Clientes cadastrados</h3>
  <div className="management-table-scroll" role="region" aria-label="Relação de clientes" tabIndex={0}>
   <table><thead><tr><th>Nome</th><th>Telefone</th><th>E-mail</th><th>Fidelidade</th><th>Ações</th></tr></thead>
   <tbody>{items.map(c=><tr key={c.id}>
    <td>{c.name}</td><td>{c.phone||'—'}</td><td>{c.email||'—'}</td>
    <td>{c.loyalty_opt_in?'Aderiu':'Não aderiu'}</td>
    <td><button className="light-button" type="button" disabled={busy}
     onClick={()=>showCustomer(c)}>Pontos e consentimentos</button>
     <button className="light-button" type="button" disabled={busy}
      onClick={()=>void anonymize(c)}>Anonimizar</button></td>
   </tr>)}</tbody></table>
  </div>
  {selected&&<section className="management-section" aria-label="Detalhes de fidelidade">
   <h3>{selected.name} — pontos e consentimentos</h3>
   <div className="management-kpis">
    <div><span>Saldo de pontos</span><strong>{points?.points??'…'}</strong></div>
    <div><span>Crédito disponível para compras</span><strong>{points?brl(points.credit_cents):'…'}</strong></div>
   </div>
   <p>Acúmulo: 1 ponto por R$ 1 de compra. Resgate: 1 ponto convertido em R$ 0,01 de crédito da loja, sem API paga.</p>
   <div className="management-form">
    <label><input type="checkbox" checked={loyalty} onChange={e=>setLoyalty(e.target.checked)}/>
     Participação em fidelidade</label>
    <label><input type="checkbox" checked={marketing} onChange={e=>setMarketing(e.target.checked)}/>
     Comunicações comerciais</label>
    <button type="button" disabled={busy} onClick={()=>void changeConsent()}>Atualizar consentimentos</button>
   </div>
   <form className="management-form" onSubmit={e=>void redeemPoints(e)}>
    <label>Resgatar pontos <input type="number" min={100} max={1000000}
     value={redeem} onChange={e=>setRedeem(Number(e.target.value))} required/></label>
    <button disabled={busy||!points||redeem<100||redeem>points.points}>Converter em crédito</button>
   </form>
   <button className="light-button" type="button" onClick={()=>setSelected(null)}>Fechar</button>
  </section>}
 </section>;
}
