import {useCallback,useEffect,useState} from 'react';
import type {FormEvent} from 'react';
import type {Session} from './api-client.ts';
import {headers,jsonRequest} from './api-client.ts';

type Status={
 configured:boolean;connected:{slug:string;enabled:boolean;last_attempt_at:string|null;last_success_at:string|null;last_error:string|null}|null;
 pending_orders:number;pending_changes:number;marketplace_url:string;
};
type OnlineOrder={remote_id:string;customer_name:string;customer_phone:string;status:'pending'|'accepted'|'rejected';remote_status:string;
 created_at:string;lines:Array<{sku:string|null;name:string|null;quantity:number}>};
const describe=(error:unknown)=>error instanceof Error?error.message:'Não foi possível concluir a operação';
export function MarketplaceSyncPanel({session}:{session:Session}){
 const [status,setStatus]=useState<Status|null>(null);
 const [orders,setOrders]=useState<OnlineOrder[]>([]);
 const [slug,setSlug]=useState('');
 const [key,setKey]=useState('');
 const [busy,setBusy]=useState(false);
 const [editingKey,setEditingKey]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const refresh=useCallback(async(signal?:AbortSignal)=>{
  const init={headers:headers(session),signal};
  const [s,o]=await Promise.all([
   jsonRequest<Status>('/v1/management/marketplace/status',init,fetch),
   jsonRequest<{orders:OnlineOrder[]}>('/v1/management/marketplace/orders',init,fetch)
  ]);
  if(signal?.aborted)return;
  setStatus(s);setOrders(o.orders);
 },[session]);
 useEffect(()=>{
  const controller=new AbortController();
  void refresh(controller.signal).catch(e=>{if(!controller.signal.aborted)setError(describe(e));});
  const timer=setInterval(()=>void refresh(controller.signal).catch(()=>{}),30_000);
  return ()=>{controller.abort();clearInterval(timer);};
 },[refresh]);
 async function connect(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   await jsonRequest('/v1/management/marketplace/connect',{
    method:'POST',headers:{...headers(session),'content-type':'application/json'},
    body:JSON.stringify({slug:slug.trim().toLowerCase(),sync_key:key.trim()})
   },fetch);
   setKey('');setEditingKey(false);setNotice('Vitrine conectada. A publicação inicia com a próxima sincronização.');
   await refresh();
  }catch(e){setError(describe(e));}finally{setBusy(false);}
 }
 async function control(command:'sync'|'enable'|'disable'){
  if(busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   if(command==='sync'){
    const r=await jsonRequest<{published?:number;received?:number;decisions?:number;busy?:boolean}>('/v1/management/marketplace/sync-now',{
     method:'POST',headers:headers(session)
    },fetch);
    setNotice(r.busy?'Outra sincronização está em execução.':
     'Sincronização: '+(r.published||0)+' alterações, '+(r.received||0)+' pedidos novos e '+(r.decisions||0)+' decisões enviadas.');
   }else{
    await jsonRequest('/v1/management/marketplace',{
     method:'PATCH',headers:{...headers(session),'content-type':'application/json'},
     body:JSON.stringify({enabled:command==='enable'})
    },fetch);
    setNotice(command==='enable'?'Vitrine online ativada.':'Sincronização pausada. Seu PDV continua funcionando normalmente.');
   }
   await refresh();
  }catch(e){setError(describe(e));}finally{setBusy(false);}
 }
 async function decide(order:OnlineOrder,decision:'accepted'|'rejected'){
  if(busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   await jsonRequest('/v1/management/marketplace/orders/'+order.remote_id+'/decision',{
    method:'POST',headers:{...headers(session),'content-type':'application/json'},body:JSON.stringify({decision})
   },fetch);
   setNotice(decision==='accepted'
    ?'Pedido confirmado. Peças reservadas no PostgreSQL; o marketplace receberá a atualização.'
    :'Pedido recusado. Se havia reserva, ela foi devolvida ao estoque disponível.');
   await refresh();
  }catch(e){setError(describe(e));}finally{setBusy(false);}
 }
 const active=status?.connected?.enabled===true;
 const link=status?.connected?.slug
  ?new URL('/loja/'+status.connected.slug,status.marketplace_url).href:null;
 return <div className="marketplace-sync-panel">
  <h3>Conectar ao marketplace ArtiSys</h3>
  <p className="muted">Opcional. Suas vendas e o estoque continuam locais no PostgreSQL. A internet é necessária somente para publicar peças e receber solicitações.</p>
  {(!status?.configured||editingKey)&&<form onSubmit={event=>void connect(event)} className="management-form">
   <label>Identificador da vitrine<input value={slug} required minLength={3} maxLength={48}
    pattern="[a-z0-9-]{3,48}" placeholder="minha-boutique" autoCapitalize="none"
    onChange={event=>setSlug(event.target.value)} disabled={busy}/></label>
   <label>Chave de sincronização <input type="password" value={key} required minLength={64} maxLength={64}
    autoComplete="off" placeholder="Chave de uso exclusivo desta loja"
    onChange={event=>setKey(event.target.value)} disabled={busy}/></label>
   <p className="muted">A ArtiSys fornece os dados da vitrine após a liberação da licença. A chave é armazenada apenas no backend local, protegida em disco.</p>
   <button className="primary-action" disabled={busy||key.trim().length!==64}>{busy?'Verificando…':'Conectar vitrine'}</button>
  </form>}
  {status?.configured&&<section aria-label="Estado da sincronização">
   <p><strong>Vitrine:</strong> {status.connected?.slug} · {active?'Sincronização ativa':'Pausada'}</p>
   {link&&<p><a href={link} target="_blank" rel="noopener noreferrer">Abrir vitrine publicada</a></p>}
   <p><strong>Última conexão:</strong> {status.connected?.last_success_at?new Date(status.connected.last_success_at).toLocaleString('pt-BR'):'Aguardando primeira sincronização'}</p>
   <p><strong>Alterações na fila:</strong> {status.pending_changes} · <strong>Pedidos aguardando:</strong> {status.pending_orders}</p>
   {status.connected?.last_error&&<p role="alert">Última falha de sincronização: {status.connected.last_error}</p>}
   <div className="marketplace-sync-actions">
    {!editingKey&&<button type="button" className="light-button" disabled={busy} onClick={()=>{
     setSlug(status.connected?.slug||'');setKey('');setEditingKey(true);
    }}>Atualizar chave</button>}
    {editingKey&&<button type="button" className="light-button" disabled={busy} onClick={()=>{setKey('');setEditingKey(false);}}>Cancelar alteração de chave</button>}
    <button type="button" className="primary-action" disabled={busy||!active} onClick={()=>void control('sync')}>{busy?'Processando…':'Sincronizar agora'}</button>
    <button type="button" className="light-button" disabled={busy} onClick={()=>void control(active?'disable':'enable')}>{active?'Pausar sincronização':'Ativar sincronização'}</button>
   </div>
  </section>}
  <section aria-label="Pedidos do marketplace">
   <h3>Solicitações de retirada</h3>
   {!orders.length?<p className="muted">Nenhum pedido online registrado neste computador.</p>:
    <div className="management-table-scroll" role="region" aria-label="Pedidos online" tabIndex={0}>
     <table><thead><tr><th>Cliente</th><th>Peças</th><th>Estado</th><th>Ações</th></tr></thead>
     <tbody>{orders.map(order=><tr key={order.remote_id}>
      <td><strong>{order.customer_name}</strong><br/><small>{order.customer_phone||'Sem telefone'} · {new Date(order.created_at).toLocaleString('pt-BR')}</small></td>
      <td>{order.lines.map(line=><div key={line.sku||line.name}>{line.quantity} × {line.name||line.sku||'SKU indisponível'} {line.sku?'('+line.sku+')':''}</div>)}</td>
      <td>{order.status==='pending'?'Aguardando confirmação':order.status==='accepted'?'Confirmado — reservado':'Recusado'}{order.remote_status!==order.status&&<small> · Atualização online pendente</small>}</td>
      <td>{order.status==='pending'&&<button type="button" className="light-button" disabled={busy} onClick={()=>void decide(order,'accepted')}>Confirmar e reservar</button>}
      {order.status!=='rejected'&&<button type="button" className="light-button" disabled={busy} onClick={()=>void decide(order,'rejected')}>Recusar / cancelar</button>}</td>
     </tr>)}</tbody></table>
    </div>}
  </section>
  {notice&&<p role="status">{notice}</p>}
  {error&&<p role="alert" className="error">{error}</p>}
 </div>;
}
