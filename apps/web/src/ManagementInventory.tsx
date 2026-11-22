import {useEffect,useRef,useState} from 'react';
import {ApiError,headers,jsonRequest,scanCatalog} from './api-client.ts';
import type {Session} from './api-client.ts';
import {mapCatalog} from './catalog-model.ts';
import {requestId} from './request-id.ts';
type Line={variant_id:string;name:string;sku:string;color:string;size:string;expected_on_hand:string;counted_on_hand:string};
type Count={active:boolean;id?:string;started_at?:string;lines:Line[]};
export function ManagementInventory({session,onSaved}:{session:Session;onSaved:()=>void}){
 const [count,setCount]=useState<Count|null>(null),[code,setCode]=useState(''),[quantity,setQuantity]=useState('');
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [revision,setRevision]=useState(0),pending=useRef(new Map<string,string>());
 const manager=session.roles.includes('manager');
 useEffect(()=>{
  let active=true;
  void jsonRequest<Count>('/v1/management/inventory-counts/current',{headers:headers(session)},fetch)
   .then(data=>{if(active)setCount(data);})
   .catch(err=>{if(active)setError(err instanceof Error?err.message:'Falha ao carregar inventário');});
  return ()=>{active=false;};
 },[session,revision]);
 async function operate(path:string,payload?:unknown){
  if(busy)return;
  const body=payload===undefined?undefined:JSON.stringify(payload),signature=path+(body||'');
  const key=pending.current.get(signature)||requestId();pending.current.set(signature,key);
  setBusy(true);setError('');setNotice('');
  try{
   const result=await jsonRequest<Record<string,unknown>>(path,{method:'POST',
    headers:{...headers(session,key),...(body?{'content-type':'application/json'}:{})},body},fetch);
   pending.current.delete(signature);setRevision(n=>n+1);onSaved();
   setNotice(result.closed?'Inventário conciliado. Divergências foram registradas no histórico.':'Registro salvo.');
   if(body){setCode('');setQuantity('');}
  }catch(err){
   if(err instanceof ApiError&&err.status>=400&&err.status<500)pending.current.delete(signature);
   setError(err instanceof Error?err.message:'Falha ao concluir o inventário.');
  }finally{setBusy(false);}
 }
 async function add(){
  if(!count?.id)return;
  if(!/^\d+$/.test(quantity)){setError('Quantidade deve ser inteira e não negativa.');return;}
  setBusy(true);setError('');
  try{
   const catalog=mapCatalog(await scanCatalog(session,code));
   const exact=catalog.flatMap(p=>p.variants).filter(v=>v.sku.toUpperCase()===code.trim().toUpperCase()||
    (v.barcode||'').toUpperCase()===code.trim().toUpperCase());
   if(exact.length!==1)throw Error('Informe um SKU/código de barras único.');
   setBusy(false);
   await operate('/v1/management/inventory-counts/'+count.id+'/lines',
    {variant_id:exact[0].id,counted_on_hand:Number(quantity)});
  }catch(err){setBusy(false);setError(err instanceof Error?err.message:'Não foi possível localizar SKU');}
 }
 return <section className="management-section" aria-label="Inventário físico">
  <h2>Inventário físico</h2><p>Contagem sobre o saldo canônico. Vendas ocorridas durante a contagem bloqueiam o fechamento até recontagem.</p>
  {!count?<p role="status">Carregando contagem…</p>:!count.active?
   <button className="primary-action" disabled={busy} onClick={()=>void operate('/v1/management/inventory-counts')}>Iniciar inventário</button>:
   <>
    <p>Inventário em andamento: {count.lines.length} SKUs conferidos.</p>
    <form className="management-form" onSubmit={e=>{e.preventDefault();void add();}}>
     <label>SKU ou código de barras<input value={code} onChange={e=>setCode(e.target.value)} required autoComplete="off"/></label>
     <label>Quantidade física<input type="number" min={0} step={1} value={quantity} onChange={e=>setQuantity(e.target.value)} required/></label>
     <button className="primary-action" disabled={busy||!code.trim()}>Salvar contagem</button>
    </form>
    <div className="management-table-scroll" role="region" tabIndex={0} aria-label="Itens contados">
     <table><thead><tr><th>SKU</th><th>Peça</th><th>Saldo observado</th><th>Contado</th></tr></thead>
      <tbody>{count.lines.map(l=><tr key={l.variant_id}><td>{l.sku}</td><td>{l.name} · {l.color} · {l.size}</td>
       <td>{l.expected_on_hand}</td><td>{l.counted_on_hand}</td></tr>)}</tbody></table>
    </div>
    {manager&&<button className="primary-action" disabled={busy||!count.lines.length}
     onClick={()=>{if(window.confirm('Conferiu os itens? A conciliação altera o estoque real.'))
       void operate('/v1/management/inventory-counts/'+count.id+'/close');}}>Concluir e conciliar inventário</button>}
   </>}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}
 </section>;
}
