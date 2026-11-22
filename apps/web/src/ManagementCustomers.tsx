import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {ApiError,headers,jsonRequest} from './api-client.ts';
import type {Session} from './api-client.ts';
import {requestId} from './request-id.ts';
type Customer={id:string;name:string;phone:string|null;email:string|null;marketing_consent:boolean};
export function ManagementCustomers({session}:{session:Session}){
 const [items,setItems]=useState<Customer[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 const pending=useRef<{body:string;key:string}|null>(null);
 useEffect(()=>{
  let alive=true;
  void jsonRequest<{items:Customer[]}>('/v1/management/customers',{headers:headers(session)},fetch)
   .then(r=>{if(alive)setItems(r.items);})
   .catch(e=>{if(alive)setError(e instanceof Error?e.message:'Erro ao buscar clientes')});
  return ()=>{alive=false;};
 },[session,revision]);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;
  const form=event.currentTarget;const data=new FormData(form);
  const body=JSON.stringify({name:String(data.get('name')).trim(),phone:String(data.get('phone')).trim()||null,
   email:String(data.get('email')).trim()||null,marketing_consent:data.get('consent')==='on'});
  const key=pending.current?.body===body?pending.current.key:requestId();pending.current={key,body};
  setBusy(true);setError('');setNotice('');
  try{
   await jsonRequest('/v1/management/customers',{method:'POST',headers:{...headers(session,key),'content-type':'application/json'},body},fetch);
   pending.current=null;form.reset();setRevision(n=>n+1);setNotice('Cliente cadastrado.');
  }catch(e){if(e instanceof ApiError&&e.status>=400&&e.status<500)pending.current=null;
   setError(e instanceof Error?e.message:'Falha ao cadastrar cliente.');}
  finally{setBusy(false);}
 }
 async function anonymize(item:Customer){
  if(busy||!window.confirm('Anonimizar dados pessoais de '+item.name+'? Esta ação não pode ser desfeita.'))return;
  setBusy(true);setError('');
  try{
   await jsonRequest('/v1/management/customers/'+item.id+'/anonymize',{method:'POST',headers:headers(session,requestId())},fetch);
   setRevision(n=>n+1);setNotice('Dados pessoais anonimizados.');
  }catch(e){setError(e instanceof Error?e.message:'Falha ao anonimizar cliente');}
  finally{setBusy(false);}
 }
 return <section className="management-section" aria-label="Clientes da loja">
  <h2>Clientes</h2><p>Cadastro local mínimo. Comunicações comerciais não são enviadas automaticamente.</p>
  <form className="management-form" onSubmit={e=>void submit(e)}>
   <label>Nome<input name="name" minLength={2} maxLength={120} required/></label>
   <label>Telefone (opcional)<input name="phone" type="tel" maxLength={24}/></label>
   <label>E-mail (opcional)<input name="email" type="email" maxLength={254}/></label>
   <label><input name="consent" type="checkbox"/> Cliente autorizou comunicações comerciais</label>
   <button className="primary-action" disabled={busy}>Cadastrar cliente</button>
  </form>
  {notice&&<p role="status">{notice}</p>}{error&&<p className="error" role="alert">{error}</p>}
  <h3>Clientes cadastrados (até 100)</h3>
  <div className="management-table-scroll" role="region" aria-label="Cadastro de clientes" tabIndex={0}>
   <table><thead><tr><th>Nome</th><th>Telefone</th><th>E-mail</th><th>Consentimento</th><th>Ação</th></tr></thead>
   <tbody>{items.map(item=><tr key={item.id}><td>{item.name}</td><td>{item.phone||'—'}</td>
    <td>{item.email||'—'}</td><td>{item.marketing_consent?'Sim':'Não'}</td>
    <td><button type="button" className="light-button" disabled={busy} onClick={()=>void anonymize(item)}>Anonimizar</button></td>
   </tr>)}</tbody></table>
  </div>
 </section>;
}
