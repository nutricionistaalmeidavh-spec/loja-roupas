import {useEffect,useState} from 'react';
import type {FormEvent} from 'react';
import type {Session,GalleryPhoto} from './api-client.ts';
import {listProductPhotos,addGalleryPhoto,deleteGalleryPhoto,fetchGalleryThumbnail,fetchProductPhoto} from './api-client.ts';
import type {Product} from './catalog-model.ts';
import {requestId} from './request-id.ts';

function GalleryThumbnail({session,productId,photo}:{session:Session;productId:string;photo:GalleryPhoto}){
 const [src,setSrc]=useState<string|null>(null);
 useEffect(()=>{
  const ctrl=new AbortController();let objectUrl:string|null=null;
  setSrc(null);
  const task=photo.is_primary
   ?fetchProductPhoto(session,productId,fetch,ctrl.signal,photo.sha256)
   :fetchGalleryThumbnail(session,productId,photo.id,photo.sha256,fetch,ctrl.signal);
  void task.then(blob=>{
   if(ctrl.signal.aborted)return;
   objectUrl=URL.createObjectURL(blob);setSrc(objectUrl);
  }).catch(()=>{if(!ctrl.signal.aborted)setSrc(null);});
  return ()=>{ctrl.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[session,productId,photo.id,photo.sha256,photo.is_primary]);
 return src?<img src={src} alt={photo.is_primary?'Fotografia principal':'Fotografia adicional'}
   loading="lazy" decoding="async" style={{width:120,height:140,objectFit:'contain'}}/>
  :<span className="muted small">Sem miniatura</span>;
}

/** Optional local photo gallery. The legacy primary photo remains canonical. */
export function CatalogGalleryEditor({session,product,refresh,onSaved}:{
 session:Session;product:Product;refresh:number;onSaved:()=>void;
}){
 const [photos,setPhotos]=useState<GalleryPhoto[]>([]);
 const [file,setFile]=useState<File|null>(null);
 const [variantId,setVariantId]=useState('');
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [reload,setReload]=useState(0);
 useEffect(()=>{
  const ctrl=new AbortController();
  setLoading(true);
  void listProductPhotos(session,product.id,fetch,ctrl.signal).then(data=>{
   if(!ctrl.signal.aborted){setPhotos(data.items);setError('');}
  }).catch(err=>{if(!ctrl.signal.aborted)setError(err instanceof Error?err.message:'Falha ao carregar fotos');})
   .finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
  return ()=>ctrl.abort();
 },[session,product.id,refresh,reload]);
 async function add(event:FormEvent){
  event.preventDefault();if(busy||!file)return;
  if(!photos.some(p=>p.is_primary)){setError('Cadastre a fotografia principal antes das fotos adicionais.');return;}
  if(photos.length>=8){setError('Limite de oito fotografias por produto.');return;}
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2097152||file.size<16){
   setError('Selecione PNG, JPEG ou WebP válido, até 2 MiB.');return;
  }
  setBusy(true);setError('');setNotice('');
  try{
   await addGalleryPhoto(session,product.id,file,requestId(),variantId||null);
   setFile(null);setVariantId('');setNotice('Foto adicional salva com auditoria.');
   setReload(n=>n+1);onSaved();
  }catch(err){setError(err instanceof Error?err.message:'Falha ao adicionar foto');}
  finally{setBusy(false);}
 }
 async function remove(photo:GalleryPhoto){
  if(photo.is_primary||busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   await deleteGalleryPhoto(session,product.id,photo.id,requestId());
   setNotice('Fotografia removida com registro de auditoria.');
   setReload(n=>n+1);onSaved();
  }catch(err){setError(err instanceof Error?err.message:'Falha ao remover foto');}
  finally{setBusy(false);}
 }
 return <section className="editor-block" aria-label="Galeria de fotografias">
  <h3>Galeria de fotografias</h3>
  <p className="muted small">Até 8 imagens por produto, incluindo a principal. Cada imagem extra pode ser vinculada a uma variante. Armazenamento local no PostgreSQL.</p>
  {loading&&<p role="status">Carregando galeria…</p>}
  {photos.length>0&&<div role="list" aria-label="Fotografias do produto" style={{display:'flex',gap:12,flexWrap:'wrap'}}>
   {photos.map(p=><div role="listitem" key={p.id} className="photo-upload-preview" style={{maxWidth:240}}>
    <GalleryThumbnail session={session} productId={product.id} photo={p}/>
    <div>
     <strong>{p.is_primary?'Principal':p.variant_id?'Foto da variante':'Foto adicional'}</strong>
     {p.variant_id&&<span>{product.variants.find(v=>v.id===p.variant_id)?.sku??'Variante vinculada'}</span>}
     {!p.is_primary&&<button type="button" className="light-button" disabled={busy}
       aria-label={'Excluir foto '+p.id} onClick={()=>void remove(p)}>Excluir foto</button>}
    </div>
   </div>)}
  </div>}
  <form onSubmit={e=>void add(e)}>
   <label>Nova fotografia adicional
    <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy||photos.length>=8}
     onChange={e=>setFile(e.target.files?.[0]??null)}/>
   </label>
   <label>Vincular foto à variante (opcional)
    <select value={variantId} disabled={busy} onChange={e=>setVariantId(e.target.value)}>
     <option value="">Todas as variantes</option>
     {product.variants.map(v=><option key={v.id} value={v.id}>{v.sku} · {v.color} · {v.size}</option>)}
    </select>
   </label>
   <button type="submit" className="light-button" disabled={busy||!file||photos.length>=8}>
    {busy?'Salvando…':'Adicionar à galeria'}
   </button>
  </form>
  {error&&<p role="alert" className="error">{error}</p>}
  {notice&&<p role="status" className="notice">{notice}</p>}
 </section>;
}
