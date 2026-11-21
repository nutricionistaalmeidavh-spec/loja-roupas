import { useEffect, useState } from 'react';
import type {ReactNode} from 'react';
import type { Session } from './api-client.ts';
import { fetchProductPhoto } from './api-client.ts';
import type { Product } from './catalog-model.ts';

/** A imagem vem do servidor privado da loja. Sem CDN, serviços externos ou foto fictícia. */
export function ProductPhoto({session,product,fallback}:{session:Session;product:Product;fallback?:ReactNode}) {
 const [url,setUrl]=useState<string|null>(null);
 const [loading,setLoading]=useState(true);
 useEffect(()=>{
  if(!product.hasPhoto){setUrl(null);setLoading(false);return;}
  const controller=new AbortController();
  let objectUrl:string|null=null;
  setUrl(null);setLoading(true);
  void fetchProductPhoto(session,product.id,fetch,controller.signal,product.photoVersion??undefined).then(blob=>{
   if(controller.signal.aborted)return;
   objectUrl=URL.createObjectURL(blob);
   setUrl(objectUrl);
  }).catch(()=>{if(!controller.signal.aborted)setUrl(null);})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[session,product.id,product.hasPhoto,product.photoVersion]);
 if(!url)return <div className={'photo-fallback'+(loading?' is-loading':'')} aria-label={loading?'Carregando fotografia':'Fotografia não disponível'}>
   {fallback??<span className="photo-placeholder">{loading?'Carregando foto…':'Foto indisponível'}</span>}
 </div>;
 return <img className="product-image" src={url} alt={'Fotografia de '+product.name} loading="lazy" decoding="async" onError={()=>setUrl(null)}/>;
}
