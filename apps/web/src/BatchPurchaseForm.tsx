import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {listCatalog} from './api-client.ts';
import type {Session} from './api-client.ts';
import type {ApiProduct as Product} from './catalog-model.ts';
import {brl,errorText,parseReais,sendOnce} from './idempotent-post.ts';
import type {Pending} from './idempotent-post.ts';

type Row={variant_id:string;label:string;quantity:string;cost:string};
const today=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);

/**
 * Compra da grade inteira de uma vez (várias cores e tamanhos), com a conta a pagar ao fornecedor
 * gerada junto. O custo informado vira o custo das peças quando elas forem recebidas.
 */
export function BatchPurchaseForm({session,suppliers,onSaved}:{session:Session;suppliers:Array<{id:string;name:string}>;onSaved?:()=>void}){
 const [supplier,setSupplier]=useState(''),[promised,setPromised]=useState(''),[query,setQuery]=useState('');
 const [found,setFound]=useState<Product[]>([]),[rows,setRows]=useState<Row[]>([]),[cost,setCost]=useState('');
 const [payable,setPayable]=useState(true),[dueOn,setDueOn]=useState(today());
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const pending=useRef<Pending>(null);
 const canPay=session.roles.some(r=>r==='manager'||r==='buyer');
 useEffect(()=>{
  if(!query.trim()){setFound([]);return;}
  const ctrl=new AbortController();
  const timer=setTimeout(()=>{void listCatalog(session,query,fetch,ctrl.signal)
   .then(page=>{if(!ctrl.signal.aborted)setFound(page.items.slice(0,8));}).catch(()=>{});},250);
  return ()=>{clearTimeout(timer);ctrl.abort();};
 },[session,query]);
 function addProduct(product:Product){
  setRows(current=>[...current,...product.variants.filter(v=>!current.some(r=>r.variant_id===v.id)).map(v=>({
   variant_id:v.id,label:`${product.name} · ${v.color} / ${v.size} (${v.sku})`,quantity:'',cost}))]);
  setQuery('');setFound([]);
 }
 const update=(id:string,change:Partial<Row>)=>setRows(r=>r.map(x=>x.variant_id===id?{...x,...change}:x));
 let lines:{variant_id:string;quantity:number;unit_cost_cents:number}[]=[],problem='';
 try{
  lines=rows.flatMap(r=>{
   const qty=Number(r.quantity||'0');
   if(!Number.isSafeInteger(qty)||qty<0)throw new Error('Quantidade inválida em '+r.label);
   return qty?[{variant_id:r.variant_id,quantity:qty,unit_cost_cents:parseReais(r.cost)}]:[];
  });
 }catch(e){problem=errorText(e);}
 const total=lines.reduce((n,l)=>n+l.quantity*l.unit_cost_cents,0);
 async function submit(event:FormEvent){
  event.preventDefault();
  if(busy||problem||!lines.length||!supplier)return;
  setBusy(true);setError('');setNotice('');
  try{
   const out=await sendOnce<{order_ids:string[];total_cents:number;payable_id:string|null}>(session,'POST','/v1/management/purchases/batch',{
    supplier_id:supplier,lines,...(promised?{promised_on:promised}:{}),...(payable&&canPay?{payable:{due_on:dueOn}}:{})},pending);
   setNotice(`Compra registrada: ${out.order_ids.length} itens, ${brl(out.total_cents)}.${out.payable_id?' Conta a pagar criada.':''}`);
   setRows([]);onSaved?.();
  }catch(e){setError(errorText(e)+(pending.current?' Repita sem alterar para não duplicar.':''));}
  finally{setBusy(false);}
 }
 return <section aria-label="Compra em grade">
  <h2>Compra em grade</h2>
  <p className="muted">Monte o pedido com todas as cores e tamanhos de uma vez. As peças entram no estoque só depois da conferência do recebimento.</p>
  <form onSubmit={e=>void submit(e)}>
   <div className="fields-two">
    <label>Fornecedor<select required value={supplier} onChange={e=>setSupplier(e.target.value)}>
     <option value="">Selecione</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label>Previsão de entrega<input type="date" value={promised} onChange={e=>setPromised(e.target.value)}/></label>
    <label>Custo padrão por peça (R$)<input inputMode="decimal" placeholder="0,00" value={cost} onChange={e=>setCost(e.target.value)}/></label>
    <label>Buscar produto<input value={query} placeholder="Nome ou SKU" onChange={e=>setQuery(e.target.value)}/></label>
   </div>
   {found.length>0&&<ul>{found.map(p=><li key={p.id}>{p.name} ({p.variants.length} variações){' '}
    <button type="button" className="light-button" onClick={()=>addProduct(p)}>Adicionar grade</button></li>)}</ul>}
   {rows.length>0&&<div className="management-table-scroll" role="region" aria-label="Itens da compra" tabIndex={0}>
    <table><thead><tr><th>Peça</th><th>Quantidade</th><th>Custo (R$)</th><th></th></tr></thead>
    <tbody>{rows.map(r=><tr key={r.variant_id}><td>{r.label}</td>
     <td><input aria-label={'Quantidade '+r.label} type="number" min={0} value={r.quantity} onChange={e=>update(r.variant_id,{quantity:e.target.value})}/></td>
     <td><input aria-label={'Custo '+r.label} inputMode="decimal" value={r.cost} onChange={e=>update(r.variant_id,{cost:e.target.value})}/></td>
     <td><button type="button" className="light-button" onClick={()=>setRows(x=>x.filter(y=>y.variant_id!==r.variant_id))}>Tirar</button></td></tr>)}</tbody></table>
   </div>}
   {canPay&&<label><input type="checkbox" checked={payable} onChange={e=>setPayable(e.target.checked)}/> Gerar conta a pagar ao fornecedor</label>}
   {canPay&&payable&&<label>Vencimento da conta<input type="date" required value={dueOn} onChange={e=>setDueOn(e.target.value)}/></label>}
   <p role="status">{lines.reduce((n,l)=>n+l.quantity,0)} peças · total {brl(total)}</p>
   {problem&&<p role="alert" className="error">{problem}</p>}
   <button className="primary-action" disabled={busy||Boolean(problem)||!lines.length||!supplier}>{busy?'Registrando…':'Registrar compra'}</button>
  </form>
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}
 </section>;
}
