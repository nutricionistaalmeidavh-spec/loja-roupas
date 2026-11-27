import {useEffect,useState} from 'react';
import type {FormEvent} from 'react';
import type {Session,ProductGalleryItem} from './api-client.ts';
import {ApiError,listProductGallery,uploadGalleryPhoto,deleteGalleryPhoto,fetchGalleryThumbnail} from './api-client.ts';
import type {Product} from './catalog-model.ts';
import {ProductPhoto} from './ProductPhoto.tsx';
import {requestId} from './request-id.ts';

function Tile({session,product,item,onDelete,busy}:{session:Session;product:Product;item:ProductGalleryItem;onDelete:(id:string)=>void;busy:boolean}){
 const [url,setUrl]=useState<string|null>(null);
 useEffect(()=>{
  if(item.primary)return;
  const controller=new AbortController();
  let objectUrl:string|null=null;
  setUrl(null);
  void fetchGalleryThumbnail(session,product.id,item.id,item.sha256,fetch,controller.signal)
   .then(blob=>{if(controller.signal.aborted)return;objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);})
   .catch(()=>{if(!controller.signal.aborted)setUrl(null);});
  return ()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[session,product.id,item.id,item.sha256,item.primary]);
 return <div className="editor-block" style={{minWidth:0,padding:12}}>
  <div style={{height:130,display:'grid',placeItems:'center',overflow:'hidden'}}>
   {item.primary?<ProductPhoto session={session} product={product}/>:url?
     <img src={url} alt={'Foto adicional '+item.position+' de '+product.name} loading="lazy"
      style={{maxWidth:'100%',maxHeight:130,objectFit:'contain'}}/>:
     <span className="muted small">Miniatura indisponível</span>}
  </div>
  <p className="muted small">{item.primary?'Foto principal':'Foto '+(item.position+1)}
   {item.variant_id?' · vinculada à variante':''}</p>
  {!item.primary&&<button type="button" className="light-button" disabled={busy}
    onClick={()=>onDelete(item.id)} aria-label={'Excluir foto '+(item.position+1)}>Excluir foto</button>}
 </div>;
}

export function ProductGallery({session,product,onSaved}:{session:Session;product:Product;onSaved:()=>void}){
 const [items,setItems]=useState<ProductGalleryItem[]>([]);
 const [file,setFile]=useState<File|null>(null);
 const [variantId,setVariantId]=useState('');
 const [refresh,setRefresh]=useState(0);
 const [loading,setLoading]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [pending,setPending]=useState<{key:string;signature:string}|null>(null);
 const [deletePending,setDeletePending]=useState<{key:string;id:string}|null>(null);
 useEffect(()=>{
  const controller=new AbortController();
  setItems([]);setFile(null);setVariantId('');setPending(null);setDeletePending(null);
  return ()=>controller.abort();
 },[product.id]);
 useEffect(()=>{
  const controller=new AbortController();
  setLoading(true);
  void listProductGallery(session,product.id,fetch,controller.signal)
   .then(page=>{if(!controller.signal.aborted)setItems(page.items);})
   .catch(err=>{if(!controller.signal.aborted)setError(err instanceof Error?err.message:'Falha ao carregar galeria');})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[session,product.id,refresh]);
 async function submit(event:FormEvent){
  event.preventDefault();
  if(busy||!file)return;
  setError('');setNotice('');
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2097152||file.size<16){
   setError('Selecione PNG, JPEG ou WebP de até 2 MiB');return;
  }
  const signature=[product.id,variantId,file.name,file.size,file.lastModified].join(':');
  if(pending&&pending.signature!==signature){
   setError('Envio pendente; repita com a mesma fotografia antes de alterar os dados');return;
  }
  const key=pending?.key??requestId();
  setPending({key,signature});setBusy(true);
  try{
   await uploadGalleryPhoto(session,product.id,file,key,variantId||null);
   setPending(null);setFile(null);setNotice('Fotografia adicionada à galeria e auditada.');
   setRefresh(n=>n+1);onSaved();
  }catch(err){
   setError(err instanceof Error?err.message:'Falha ao salvar fotografia');
   if(err instanceof ApiError&&err.status>=400&&err.status<500)setPending(null);
  }finally{setBusy(false);}
 }
 async function remove(id:string){
  if(busy||pending)return;
  setError('');setNotice('');
  const key=deletePending?.id===id?deletePending.key:requestId();
  setDeletePending({key,id});setBusy(true);
  try{
   await deleteGalleryPhoto(session,product.id,id,key);
   setDeletePending(null);setNotice('Fotografia removida com registro de auditoria.');
   setRefresh(n=>n+1);onSaved();
  }catch(err){
   setError(err instanceof Error?err.message:'Falha ao remover foto');
   if(err instanceof ApiError&&err.status>=400&&err.status<500)setDeletePending(null);
  }finally{setBusy(false);}
 }
 const filled=items.filter(item=>!item.primary).length;
 return <section className="editor-block" aria-label="Galeria de fotografias do produto">
  <h3>Galeria de fotografias</h3>
  <p className="muted small">Foto principal preservada. Até 7 fotos adicionais por produto, inclusive vinculadas a uma variante.</p>
  {loading&&<p role="status">Carregando galeria…</p>}
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:10}}>
   {items.map(item=><Tile key={item.id} session={session} product={product} item={item} onDelete={id=>void remove(id)} busy={busy}/>)}
  </div>
  {!loading&&!items.length&&<p className="muted small">Ainda não há fotografias na galeria.</p>}
  <form onSubmit={e=>void submit(e)}>
   <label>Fotografia adicional
    <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy||Boolean(pending)||filled>=7}
     onChange={e=>setFile(e.target.files?.[0]??null)}/>
   </label>
   <label>Variante (opcional)
    <select value={variantId} disabled={busy||Boolean(pending)} onChange={e=>setVariantId(e.target.value)}>
     <option value="">Todas as variantes</option>
     {product.variants.map(variant=><option key={variant.id} value={variant.id}>{variant.sku} · {variant.color} · {variant.size}</option>)}
    </select>
   </label>
   <button type="submit" className="light-button" disabled={!file||busy||filled>=7}>Adicionar foto à galeria</button>
   {filled>=7&&<p className="muted small">Limite de fotos adicionais atingido.</p>}
  </form>
  {error&&<p className="error" role="alert">{error}</p>}
  {notice&&<p className="notice" role="status">{notice}</p>}
 </section>;
}
