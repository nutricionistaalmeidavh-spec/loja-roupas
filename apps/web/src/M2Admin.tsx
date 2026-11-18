import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, adjustStock, listCatalog, listMovements, patchProduct, patchVariantPrice, uploadPhoto } from './api-client.ts';
import type { Session, StockMovement } from './api-client.ts';
import { mapCatalog, reaisToCents } from './catalog-model.ts';
import type { Product } from './catalog-model.ts';

function message(error:unknown){return error instanceof Error?error.message:'Operação indisponível';}
type Pending={key:string;payload:string};
export function M2CatalogEditor({session,onSaved}:{session:Session;onSaved:()=>void}){
 const [search,setSearch]=useState('');
 const [products,setProducts]=useState<Product[]>([]);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [productId,setProductId]=useState('');
 const [name,setName]=useState('');
 const [category,setCategory]=useState('');
 const [variantId,setVariantId]=useState('');
 const [price,setPrice]=useState('');
 const [photo,setPhoto]=useState<File|null>(null);
 const [pending,setPending]=useState<Pending|null>(null);
 const [busy,setBusy]=useState(false);
 const [refresh,setRefresh]=useState(0);
 const current=useMemo(()=>products.find(p=>p.id===productId),[products,productId]);
 const variant=current?.variants.find(v=>v.id===variantId);
 useEffect(()=>{
  const controller=new AbortController();
  setLoading(true);
  const timer=setTimeout(()=>void listCatalog(session,search,fetch,controller.signal).then(data=>{
   if(!controller.signal.aborted)setProducts(mapCatalog(data));
  }).catch(err=>{if(!controller.signal.aborted){setProducts([]);setError(message(err));}}).finally(()=>{
   if(!controller.signal.aborted)setLoading(false);
  }),250);
  return ()=>{clearTimeout(timer);controller.abort();};
 },[session,search,refresh]);
 function selectProduct(id:string){
  setProductId(id);setVariantId('');setPending(null);
  const p=products.find(p=>p.id===id);setName(p?.name??'');setCategory(p?.category??'');
 }
 async function submit(keyType:'product'|'price'|'photo',event:FormEvent){
  event.preventDefault();
  if(!current||busy)return;
  setError('');setNotice('');
  let body='';let file=photo;
  try {
   body=keyType==='product'?JSON.stringify({name:name.trim(),category:category.trim(),expected_revision:current.revision})
    :keyType==='price'?JSON.stringify({price_cents:reaisToCents(price),expected_revision:variant?.variantRevision})
    :JSON.stringify({name:file?.name,size:file?.size,type:file?.type});
   if(keyType==='photo'&&(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2097152))
    throw new Error('Selecione PNG, JPEG ou WebP de até 2 MiB');
   if(keyType==='product'&&(!name.trim()||!category.trim()))throw new Error('Nome/categoria obrigatórios');
   if(keyType==='price'&&!variant)throw new Error('Selecione variante para editar');
  }catch(err){setError(message(err));return;}
  const scope=keyType+':'+current.id;
  if(pending&&pending.payload!==scope+':'+body){
   setError('Há uma resposta pendente. Repita o mesmo envio antes de mudar os campos.');return;
  }
  const key=pending?.key??crypto.randomUUID();
  setPending({key,payload:scope+':'+body});setBusy(true);
  try {
   if(keyType==='product')await patchProduct(session,current.id,JSON.parse(body),key);
   else if(keyType==='price')await patchVariantPrice(session,variant!.id,JSON.parse(body),key);
   else await uploadPhoto(session,current.id,file!,key);
   setPending(null);setPhoto(null);setNotice('Atualização confirmada pelo servidor.');
   setRefresh(n=>n+1);onSaved();
  }catch(err){
   setError(message(err));
   if(err instanceof ApiError&&err.status>=400&&err.status<500)setPending(null);
  }finally{setBusy(false);}
 }
 return <section className="management-form">
  <div className="form-heading"><h2>Editar catálogo, preço e fotos</h2>
    <p>Operações com revisão de versão e auditoria. Imagens armazenadas no PostgreSQL local.</p></div>
  <label>Pesquisar produto para editar
    <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nome, SKU ou código de barras"/>
  </label>
  {loading&&<p className="muted" role="status">Buscando produtos…</p>}
  <label>Produto<select aria-label="Produto para editar" value={productId} onChange={e=>selectProduct(e.target.value)}>
    <option value="">Selecione</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
  </select></label>
  {current&&<>
   <form onSubmit={e=>void submit('product',e)} className="editor-block">
     <h3>Informações</h3>
     <div className="fields-two"><label>Nome do produto<input required maxLength={200} value={name} disabled={busy||Boolean(pending)}
       onChange={e=>setName(e.target.value)}/></label>
       <label>Categoria do produto<input required maxLength={100} value={category} disabled={busy||Boolean(pending)}
       onChange={e=>setCategory(e.target.value)}/></label></div>
     <button type="submit" disabled={busy} className="light-button">Salvar informações</button>
   </form>
   <form onSubmit={e=>void submit('price',e)} className="editor-block">
    <h3>Preço por variante</h3>
    <label>Variante para preço<select aria-label="Variante para preço" value={variantId}
      onChange={e=>{setVariantId(e.target.value);setPrice('');setPending(null);}} disabled={busy}>
     <option value="">Selecione</option>
     {current.variants.map(v=><option key={v.id} value={v.id}>{v.sku} · {v.color} · {v.size}</option>)}
    </select></label>
    {variant&&<p className="muted small">Preço atual: {(variant.priceCents/100).toFixed(2).replace('.',',')} · revisão {variant.variantRevision}</p>}
    <label>Novo preço (R$)<input required inputMode="decimal" placeholder="149,90" value={price} disabled={busy||Boolean(pending)}
      onChange={e=>setPrice(e.target.value)}/></label>
    <button type="submit" className="light-button" disabled={!variant||busy}>Salvar preço</button>
   </form>
   <form onSubmit={e=>void submit('photo',e)} className="editor-block">
    <h3>Fotografia da peça</h3>
    <p className="muted small">Uma foto principal por produto; PNG, JPEG ou WebP até 2 MiB.</p>
    <label>Selecionar fotografia<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy||Boolean(pending)}
       onChange={e=>setPhoto(e.target.files?.[0]??null)}/></label>
    <button type="submit" className="light-button" disabled={!photo||busy}>Enviar fotografia local</button>
   </form>
  </>}
  {error&&<p role="alert" className="error">{error}</p>}
  {notice&&<p role="status" className="notice">{notice}</p>}
 </section>;
}
export function M2StockAdjustment({session,onSaved,refreshKey}:{session:Session;onSaved:()=>void;refreshKey:number}){
 const [q,setQ]=useState('');const [products,setProducts]=useState<Product[]>([]);
 const [variantId,setVariantId]=useState('');const [count,setCount]=useState('');const [reason,setReason]=useState('');
 const [movements,setMovements]=useState<StockMovement[]>([]);
 const [status,setStatus]=useState('');const [error,setError]=useState('');
 const [pending,setPending]=useState<Pending|null>(null);
 const [reference,setReference]=useState(()=>crypto.randomUUID());
 const [busy,setBusy]=useState(false);const [refresh,setRefresh]=useState(0);
 const variants=products.flatMap(p=>p.variants.map(v=>({...v,name:p.name})));
 const selected=variants.find(v=>v.id===variantId);
 useEffect(()=>{
  const ctrl=new AbortController();
  const timer=setTimeout(()=>void listCatalog(session,q,fetch,ctrl.signal).then(data=>{
   if(!ctrl.signal.aborted)setProducts(mapCatalog(data));
  }).catch(err=>{if(!ctrl.signal.aborted)setError(message(err));}),250);
  return ()=>{clearTimeout(timer);ctrl.abort();};
 },[session,q,refresh,refreshKey]);
 useEffect(()=>{
  if(!variantId){setMovements([]);return;}
  void listMovements(session,variantId).then(x=>setMovements(x.items)).catch(()=>setMovements([]));
 },[session,variantId,refresh,refreshKey]);
 async function submit(e:FormEvent){
  e.preventDefault();if(!selected||busy)return;
  setError('');setStatus('');
  const qty=Number(count);
  if(!Number.isSafeInteger(qty)||qty<0||reason.trim().length<8){setError('Informe saldo inteiro e justificativa de ao menos 8 caracteres');return;}
  const payload={variant_id:selected.id,reference_id:reference,counted_on_hand:qty,expected_revision:selected.stockRevision,reason:reason.trim()};
  const body=JSON.stringify(payload);
  if(pending&&pending.payload!==body){setError('Envio pendente: mantenha os dados para repetir');return;}
  const key=pending?.key??crypto.randomUUID();setPending({key,payload:body});setBusy(true);
  try{
    const result=await adjustStock(session,payload,key);
    setStatus('Ajuste registrado. Saldo total em mãos: '+result.on_hand);
    setPending(null);setReference(crypto.randomUUID());setCount('');setReason('');
    setRefresh(x=>x+1);onSaved();
  }catch(err){setError(message(err));if(err instanceof ApiError&&err.status>=400&&err.status<500)setPending(null);}
  finally{setBusy(false);}
 }
 return <form onSubmit={e=>void submit(e)} className="management-form">
  <div className="form-heading"><h2>Ajuste gerencial e histórico</h2><p>Corrige estoque físico com versão esperada, motivo e movimento auditado.</p></div>
  <label>Localizar SKU para conferência<input placeholder="Pesquisar nome ou SKU" value={q} onChange={e=>setQ(e.target.value)}/></label>
  <label>Variante para ajustar<select value={variantId} required onChange={e=>setVariantId(e.target.value)}>
   <option value="">Selecione</option>{variants.map(v=><option key={v.id} value={v.id}>{v.name} · {v.sku} · saldo {v.available}</option>)}
  </select></label>
  {selected&&<p className="muted small">Disponível: {selected.available} · revisão de estoque: {selected.stockRevision}</p>}
  <div className="fields-two"><label>Saldo físico contado<input type="number" required step="1" min="0" value={count}
    disabled={busy||Boolean(pending)} onChange={e=>setCount(e.target.value)}/></label>
    <label>Motivo do ajuste<input required minLength={8} maxLength={250} value={reason} disabled={busy||Boolean(pending)}
      onChange={e=>setReason(e.target.value)}/></label></div>
  <button className="primary-action" disabled={!selected||busy}>Confirmar ajuste gerencial</button>
  {error&&<p role="alert" className="error">{error}</p>}
  {status&&<p role="status" className="notice">{status}</p>}
  {movements.length>0&&<div className="editor-block"><h3>Movimentos recentes</h3>
    {movements.map(m=><p key={m.id}>{m.movement_kind} · {m.qty_delta>0?'+':''}{m.qty_delta} · {new Date(m.occurred_at).toLocaleString('pt-BR')}</p>)}</div>}
 </form>;
}
