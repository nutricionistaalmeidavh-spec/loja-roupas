import {useEffect,useState} from 'react';
import {headers,jsonRequest} from './api-client.ts';
import type {Session} from './api-client.ts';
import {requestId} from './request-id.ts';
import {TaskDialog} from './TaskDialog.tsx';
type Grant={user_id:string;login:string;status:string;manager:boolean;enabled:boolean;granted_by:string|null;granted_at:string|null;revoked_at:string|null};
export function DirectReceiptPermissions({session,onClose}:{session:Session;onClose:()=>void}){
 const [users,setUsers]=useState<Grant[]>([]);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState<string|null>(null);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 async function load(){
  setLoading(true);setError('');
  try{const data=await jsonRequest<{grants:Grant[]}>('/v1/stock/direct-receipt/grants',{headers:headers(session)},fetch);setUsers(data.grants);}
  catch(e){setError(e instanceof Error?e.message:'Falha ao consultar autorizações');}
  finally{setLoading(false);}
 }
 useEffect(()=>{void load();},[session]);
 async function toggle(user:Grant){
  setBusy(user.user_id);setError('');setNotice('');
  try{
   await jsonRequest('/v1/stock/direct-receipt/grants/'+user.user_id,{
    method:'PUT',headers:{...headers(session,requestId()),'content-type':'application/json'},
    body:JSON.stringify({enabled:!user.enabled})},fetch);
   setNotice('Autorização atualizada para '+user.login);
   await load();
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível alterar a autorização');}
  finally{setBusy(null);}
 }
 return <TaskDialog title="Autorizações de entrada direta" onClose={onClose} wide>
  <div className="management-form">
   <p className="muted">Somente gestores concedem ou revogam esta exceção. O recebimento normal continua exigindo conferência.</p>
   {error&&<p role="alert" className="error">{error}</p>}
   {notice&&<p role="status" className="notice">{notice}</p>}
   {loading&&<p role="status">Carregando funcionários…</p>}
   <div className="sheet-history-table" role="region" aria-label="Autorizações individuais" tabIndex={0}>
    <table><thead><tr><th>Usuário</th><th>Autorização</th><th>Última concessão</th><th>Ação</th></tr></thead>
     <tbody>{users.map(u=><tr key={u.user_id}><td>{u.login}{u.status!=='active'?' (bloqueado)':''}</td>
      <td>{u.manager?'Gestor (permissão do perfil)':u.enabled?'Autorizado':'Não autorizado'}</td>
      <td>{u.granted_at?new Date(u.granted_at).toLocaleString('pt-BR'):'—'}</td>
      <td>{!u.manager&&<button className="light-button" type="button" disabled={busy!==null||loading||u.status!=='active'} onClick={()=>void toggle(u)}>
       {busy===u.user_id?'Salvando…':u.enabled?'Revogar':'Autorizar'}</button>}</td>
     </tr>)}</tbody></table>
   </div>
   <button className="light-button" type="button" disabled={loading||busy!==null} onClick={()=>void load()}>Atualizar</button>
  </div>
 </TaskDialog>;
}
