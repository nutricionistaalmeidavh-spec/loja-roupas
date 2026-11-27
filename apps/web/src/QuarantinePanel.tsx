import {useEffect,useRef,useState} from 'react';
import {headers,jsonRequest} from './api-client.ts';
import type {Session} from './api-client.ts';
import {errorText,sendOnce} from './idempotent-post.ts';
import type {Pending} from './idempotent-post.ts';

type Item={variant_id:string;name:string;sku:string;color:string;size:string;quarantined:string};

/** Peças devolvidas com defeito: ficam fora da venda até serem liberadas (consertadas) ou baixadas como perda. */
export function QuarantinePanel({session,onChanged}:{session:Session;onChanged?:()=>void}){
 const [items,setItems]=useState<Item[]>([]),[revision,setRevision]=useState(0);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [active,setActive]=useState<string|null>(null),[quantity,setQuantity]=useState('1'),[reason,setReason]=useState('');
 const pending=useRef<Pending>(null);
 const canWrite=session.roles.includes('manager');
 useEffect(()=>{
  const ctrl=new AbortController();
  void jsonRequest<{items:Item[]}>('/v1/stock/quarantine',{headers:headers(session),signal:ctrl.signal},fetch)
   .then(out=>{if(!ctrl.signal.aborted)setItems(out.items);})
   .catch(e=>{if(!ctrl.signal.aborted)setError(errorText(e));});
  return ()=>ctrl.abort();
 },[session,revision]);
 async function resolve(item:Item,action:'release'|'discard'){
  const qty=Number(quantity);
  if(busy||!Number.isSafeInteger(qty)||qty<1||qty>Number(item.quarantined)||reason.trim().length<8)return;
  setBusy(true);setError('');setNotice('');
  try{
   await sendOnce(session,'POST','/v1/stock/quarantine/resolve',{variant_id:item.variant_id,quantity:qty,action,reason:reason.trim()},pending);
   setNotice(action==='release'?'Peças liberadas para venda.':'Peças baixadas como perda.');
   setActive(null);setReason('');setQuantity('1');setRevision(n=>n+1);onChanged?.();
  }catch(e){setError(errorText(e));}
  finally{setBusy(false);}
 }
 return <section className="management-section" aria-label="Peças em quarentena">
  <h2>Peças em quarentena</h2>
  <p>Peças devolvidas com defeito. Não aparecem para venda até você liberar ou dar baixa.</p>
  {!items.length&&!error&&<p className="muted">Nenhuma peça em quarentena.</p>}
  {items.length>0&&<div className="management-table-scroll" role="region" aria-label="Quarentena" tabIndex={0}>
   <table><thead><tr><th>Peça</th><th>SKU</th><th>Quantidade</th><th></th></tr></thead>
   <tbody>{items.map(item=><tr key={item.variant_id}>
    <td>{item.name} · {item.color} / {item.size}</td><td>{item.sku}</td><td>{item.quarantined}</td>
    <td>{!canWrite?null:active===item.variant_id?<span>
      <input aria-label="Quantidade" type="number" min={1} max={Number(item.quarantined)} value={quantity} onChange={e=>setQuantity(e.target.value)}/>
      <input aria-label="Motivo" placeholder="Motivo (mín. 8 letras)" maxLength={250} value={reason} onChange={e=>setReason(e.target.value)}/>
      <button className="light-button" disabled={busy||reason.trim().length<8} onClick={()=>void resolve(item,'release')}>Liberar para venda</button>
      <button className="light-button" disabled={busy||reason.trim().length<8} onClick={()=>void resolve(item,'discard')}>Baixar como perda</button>
      <button className="light-button" disabled={busy} onClick={()=>setActive(null)}>Voltar</button>
     </span>:<button className="light-button" onClick={()=>{setActive(item.variant_id);setQuantity(item.quarantined);setReason('');pending.current=null;}}>Resolver</button>}</td>
   </tr>)}</tbody></table>
  </div>}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}
 </section>;
}
