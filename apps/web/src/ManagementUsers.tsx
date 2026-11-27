import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {headers,jsonRequest} from './api-client.ts';
import type {Session} from './api-client.ts';
import {errorText,sendOnce} from './idempotent-post.ts';
import {forgetPixProfile} from './PixQrCode.tsx';
import type {Pending} from './idempotent-post.ts';

type User={id:string;login:string;display_name:string|null;status:'active'|'blocked';roles:string[];pin_ready:boolean};
type Profile={name:string;legal_name:string|null;document:string|null;address:string|null;phone:string|null;
 receipt_footer:string|null;max_cashier_discount_bps:number;commission_timing?:'on_sale'|'on_payment';
 pix_key?:string|null;pix_city?:string|null};
export const ROLE_LABELS:Record<string,string>={manager:'Gestor (tudo)',cashier:'Caixa',seller:'Vendedor(a)',
 stocker:'Estoque',buyer:'Compras',technician:'Suporte técnico'};
const ROLES=Object.keys(ROLE_LABELS);

function RolePicker({value,onChange,disabled}:{value:string[];onChange:(v:string[])=>void;disabled?:boolean}){
 return <fieldset disabled={disabled}><legend>Funções</legend>
  {ROLES.map(role=><label key={role}><input type="checkbox" checked={value.includes(role)}
   onChange={e=>onChange(e.target.checked?[...value,role]:value.filter(r=>r!==role))}/> {ROLE_LABELS[role]}</label>)}
 </fieldset>;
}

/** Cadastro de quem usa o sistema e dos dados da loja que saem no comprovante. */
export function ManagementUsers({session}:{session:Session}){
 const [users,setUsers]=useState<User[]>([]);
 const [revision,setRevision]=useState(0);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [login,setLogin]=useState(''),[name,setName]=useState(''),[password,setPassword]=useState(''),[roles,setRoles]=useState<string[]>(['cashier']);
 const [editing,setEditing]=useState<string|null>(null),[editRoles,setEditRoles]=useState<string[]>([]),[editName,setEditName]=useState('');
 const [resetFor,setResetFor]=useState<string|null>(null),[newPassword,setNewPassword]=useState('');
 const pending=useRef<Pending>(null);
 useEffect(()=>{
  const ctrl=new AbortController();
  void jsonRequest<{items:User[]}>('/v1/management/users',{headers:headers(session),signal:ctrl.signal},fetch)
   .then(out=>{if(!ctrl.signal.aborted)setUsers(out.items);})
   .catch(e=>{if(!ctrl.signal.aborted)setError(errorText(e));});
  return ()=>ctrl.abort();
 },[session,revision]);
 async function run(action:()=>Promise<unknown>,done:string){
  if(busy)return;
  setBusy(true);setError('');setNotice('');
  try{await action();setNotice(done);setRevision(n=>n+1);return true;}
  catch(e){setError(errorText(e));return false;}
  finally{setBusy(false);}
 }
 async function create(event:FormEvent){
  event.preventDefault();
  if(!roles.length){setError('Escolha ao menos uma função.');return;}
  const ok=await run(()=>sendOnce(session,'POST','/v1/management/users',
   {login:login.trim(),password,roles,...(name.trim()?{display_name:name.trim()}:{})},pending),'Pessoa cadastrada. Ela já pode entrar com o login e a senha.');
  if(ok){setLogin('');setName('');setPassword('');setRoles(['cashier']);}
 }
 const update=(id:string,body:object,done:string)=>run(()=>sendOnce(session,'PUT','/v1/management/users/'+id,body,pending),done);
 return <section className="management-section" aria-label="Pessoas e loja">
  <StoreProfileForm session={session}/>
  <h2>Pessoas com acesso</h2>
  <p>Cada pessoa entra com o próprio login. Bloquear encerra as sessões abertas na hora. Sempre fica pelo menos um gestor ativo.</p>
  <div className="management-table-scroll" role="region" aria-label="Pessoas cadastradas" tabIndex={0}>
   <table><thead><tr><th>Nome</th><th>Login</th><th>Funções</th><th>Situação</th><th>Ações</th></tr></thead>
   <tbody>{users.map(user=><tr key={user.id}>
    <td>{editing===user.id?<input aria-label="Nome" maxLength={120} value={editName} onChange={e=>setEditName(e.target.value)}/>:user.display_name??'—'}</td>
    <td>{user.login}</td>
    <td>{editing===user.id?<RolePicker value={editRoles} onChange={setEditRoles} disabled={busy}/>:user.roles.map(r=>ROLE_LABELS[r]??r).join(', ')}</td>
    <td>{user.status==='active'?'Ativo':'Bloqueado'}{user.pin_ready?' · PIN do caixa ok':''}</td>
    <td>{editing===user.id?<span>
      <button className="light-button" disabled={busy||!editRoles.length} onClick={()=>void update(user.id,
       {roles:editRoles,display_name:editName.trim()||null},'Cadastro atualizado.').then(ok=>{if(ok)setEditing(null);})}>Salvar</button>{' '}
      <button className="light-button" disabled={busy} onClick={()=>setEditing(null)}>Voltar</button>
     </span>:resetFor===user.id?<span>
      <input type="password" aria-label="Nova senha" placeholder="Nova senha (mín. 12)" minLength={12} value={newPassword}
       autoComplete="new-password" onChange={e=>setNewPassword(e.target.value)}/>
      <button className="light-button" disabled={busy||newPassword.length<12} onClick={()=>void run(()=>sendOnce(session,'POST',
       '/v1/management/users/'+user.id+'/password',{password:newPassword},pending),'Senha trocada. As sessões abertas dessa pessoa foram encerradas.')
       .then(ok=>{if(ok){setResetFor(null);setNewPassword('');}})}>Trocar senha</button>
      <button className="light-button" disabled={busy} onClick={()=>setResetFor(null)}>Voltar</button>
     </span>:<span>
      <button className="light-button" disabled={busy} onClick={()=>{setEditing(user.id);setEditRoles(user.roles);setEditName(user.display_name??'');pending.current=null;}}>Editar</button>{' '}
      <button className="light-button" disabled={busy} onClick={()=>{setResetFor(user.id);setNewPassword('');pending.current=null;}}>Nova senha</button>{' '}
      {<button className="light-button" disabled={busy} onClick={()=>void update(user.id,
       {status:user.status==='active'?'blocked':'active'},user.status==='active'?'Acesso bloqueado.':'Acesso liberado.')}>
       {user.status==='active'?'Bloquear':'Desbloquear'}</button>}
     </span>}</td>
   </tr>)}</tbody></table>
  </div>
  <h3>Cadastrar pessoa</h3>
  <form className="management-form" onSubmit={e=>void create(e)}>
   <div className="fields-two">
    <label>Nome<input maxLength={120} value={name} onChange={e=>setName(e.target.value)} placeholder="Como aparece no comprovante"/></label>
    <label>Login<input required pattern="[a-zA-Z0-9._\-]{3,64}" value={login} onChange={e=>setLogin(e.target.value)} placeholder="ex.: maria.caixa"/></label>
   </div>
   <label>Senha inicial<input type="password" required minLength={12} autoComplete="new-password" value={password}
    onChange={e=>setPassword(e.target.value)} placeholder="Pelo menos 12 caracteres"/></label>
   <RolePicker value={roles} onChange={setRoles} disabled={busy}/>
   <button className="primary-action" disabled={busy}>{busy?'Salvando…':'Cadastrar pessoa'}</button>
  </form>
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}
 </section>;
}

function StoreProfileForm({session}:{session:Session}){
 const [profile,setProfile]=useState<Profile|null>(null);
 const [limit,setLimit]=useState('10');
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const pending=useRef<Pending>(null);
 useEffect(()=>{
  const ctrl=new AbortController();
  void jsonRequest<Profile>('/v1/management/store-profile',{headers:headers(session),signal:ctrl.signal},fetch)
   .then(p=>{if(!ctrl.signal.aborted){setProfile(p);setLimit(String(Number(p.max_cashier_discount_bps)/100).replace('.',','));}})
   .catch(e=>{if(!ctrl.signal.aborted)setError(errorText(e));});
  return ()=>ctrl.abort();
 },[session]);
 if(!profile)return error?<p role="alert" className="error">{error}</p>:<p role="status">Carregando dados da loja…</p>;
 const set=(key:keyof Profile)=>(e:{target:{value:string}})=>setProfile(p=>p&&({...p,[key]:e.target.value}));
 async function save(event:FormEvent){
  event.preventDefault();if(!profile||busy)return;
  const percent=Number(limit.replace(',','.'));
  if(!Number.isFinite(percent)||percent<0||percent>100){setError('Limite de desconto deve ficar entre 0 e 100%.');return;}
  setBusy(true);setError('');setNotice('');
  try{
   await sendOnce(session,'PUT','/v1/management/store-profile',{...profile,max_cashier_discount_bps:Math.round(percent*100)},pending);
   forgetPixProfile();
   setNotice('Dados da loja salvos. Os próximos comprovantes já saem com eles.');
  }catch(e){setError(errorText(e));}
  finally{setBusy(false);}
 }
 return <form className="management-form" onSubmit={e=>void save(e)}>
  <h2>Dados da loja</h2>
  <p>Aparecem no comprovante entregue à cliente.</p>
  <div className="fields-two">
   <label>Nome da loja<input required maxLength={120} value={profile.name} onChange={set('name')}/></label>
   <label>Razão social<input maxLength={160} value={profile.legal_name??''} onChange={set('legal_name')}/></label>
   <label>CNPJ ou CPF<input maxLength={32} value={profile.document??''} onChange={set('document')}/></label>
   <label>Telefone<input maxLength={32} value={profile.phone??''} onChange={set('phone')}/></label>
  </div>
  <label>Endereço<input maxLength={240} value={profile.address??''} onChange={set('address')}/></label>
  <label>Mensagem no fim do comprovante<input maxLength={240} value={profile.receipt_footer??''} onChange={set('receipt_footer')}
   placeholder="Ex.: Trocas em até 30 dias com etiqueta"/></label>
  <div className="fields-two">
   <label>Chave Pix da loja<input maxLength={77} value={profile.pix_key??''} onChange={set('pix_key')}
    placeholder="CNPJ, e-mail, telefone ou chave aleatória"/></label>
   <label>Cidade (para o QR Code do Pix)<input maxLength={60} value={profile.pix_city??''} onChange={set('pix_city')} placeholder="Ex.: São Paulo"/></label>
  </div>
  <p className="muted small">Com a chave cadastrada, o caixa mostra um QR Code com o valor da venda para a cliente pagar pelo celular.</p>
  <label>Desconto máximo que o caixa pode dar sem gestor (%)<input inputMode="decimal" value={limit} onChange={e=>setLimit(e.target.value)}/></label>
  <label>Comissão de venda no crediário
   <select value={profile.commission_timing??'on_payment'} onChange={set('commission_timing')}>
    <option value="on_payment">Pagar ao vendedor só depois que a cliente pagar</option>
    <option value="on_sale">Pagar ao vendedor na hora da venda</option>
   </select></label>
  <p className="muted small">Vale para o que ainda não foi pago aos vendedores. Vendas à vista não mudam.</p>
  <button className="primary-action" disabled={busy}>{busy?'Salvando…':'Salvar dados da loja'}</button>
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}
 </form>;
}
