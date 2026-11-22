import {useEffect,useState} from 'react';
import type {FormEvent} from 'react';
import {headers,jsonRequest} from './api-client.ts';
import type {Session} from './api-client.ts';
type Operator={id:string;login:string;pin_ready:boolean};
type Switched={token:string;store_id:string;roles:string[];user_id:string;login:string};
export function OperatorSwitch({session,onSwitch}:{session:Session;onSwitch:(session:Session)=>void}){
 const [open,setOpen]=useState(false),[people,setPeople]=useState<Operator[]>([]),[target,setTarget]=useState(''),
 [pin,setPin]=useState(''),[configure,setConfigure]=useState(false),
 [managerPassword,setManagerPassword]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{
  if(!open)return;
  let alive=true;
  void jsonRequest<{items:Operator[]}>('/v1/auth/operators',{headers:headers(session)},fetch)
   .then(r=>{if(alive){setPeople(r.items);setTarget(v=>v||r.items[0]?.id||'');}})
   .catch(e=>{if(alive)setError(e instanceof Error?e.message:'Operadores indisponíveis');});
  return ()=>{alive=false;};
 },[open,session]);
 async function change(event:FormEvent){
  event.preventDefault();if(busy)return;setBusy(true);setError('');
  try{
   if(!target)throw Error('Selecione operador');
   const r=await jsonRequest<Switched>('/v1/auth/operators/switch',{
    method:'POST',headers:{...headers(session),'content-type':'application/json'},
    body:JSON.stringify({user_id:target,pin})},fetch);
   setPin('');setOpen(false);onSwitch({...session,token:r.token,roles:r.roles});
  }catch(e){setError(e instanceof Error?e.message:'PIN inválido');}
  finally{setBusy(false);}
 }
 async function setOperatorPin(event:FormEvent){
  event.preventDefault();if(busy)return;setBusy(true);setError('');setNotice('');
  try{
   await jsonRequest('/v1/auth/operators/pin',{method:'POST',
    headers:{...headers(session),'content-type':'application/json'},
    body:JSON.stringify({user_id:target,pin,manager_password:managerPassword})},fetch);
   setNotice('PIN configurado. É possível alternar usando esse PIN neste terminal.');
   setPeople(current=>current.map(p=>p.id===target?{...p,pin_ready:true}:p));
   setPin('');setManagerPassword('');setConfigure(false);
  }catch(e){setError(e instanceof Error?e.message:'Falha ao definir PIN');}
  finally{setBusy(false);}
 }
 return <div className="operator-switch">
  <button className="light-button" type="button" onClick={()=>{setOpen(v=>!v);setError('');}}>
   Trocar operador
  </button>
  {open&&<section className="management-section" role="dialog" aria-label="Trocar operador por PIN">
   <h2>Operador local</h2>
   <p>Trocar operador encerra a sessão anterior, mas não fecha o caixa do terminal.</p>
   {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status">{notice}</p>}
   <form className="management-form" onSubmit={configure?e=>void setOperatorPin(e):e=>void change(e)}>
    <label>Conta <select required value={target} onChange={e=>setTarget(e.target.value)}>
     {people.map(p=><option value={p.id} key={p.id}>{p.login}{p.pin_ready?' · PIN ativo':' · PIN não configurado'}</option>)}
    </select></label>
    <label>PIN (6 a 8 dígitos) <input inputMode="numeric" type="password" autoComplete="off"
     minLength={6} maxLength={8} pattern="[0-9]{6,8}" value={pin} onChange={e=>setPin(e.target.value)} required/></label>
    {configure&&<label>Senha do gestor atual <input type="password" autoComplete="current-password"
      value={managerPassword} onChange={e=>setManagerPassword(e.target.value)} required/></label>}
    <button className="primary-action" type="submit" disabled={busy}>{configure?'Salvar PIN':'Trocar sessão'}</button>
    {session.roles.includes('manager')&&<button type="button" className="light-button"
      onClick={()=>{setConfigure(v=>!v);setError('');setPin('');}}>{configure?'Voltar à troca':'Configurar PIN como gestor'}</button>}
    <button type="button" className="light-button" onClick={()=>setOpen(false)}>Fechar</button>
   </form>
  </section>}
 </div>;
}
