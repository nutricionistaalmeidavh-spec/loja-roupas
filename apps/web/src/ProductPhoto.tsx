import { useEffect, useState } from 'react';
import type { Session } from './api-client.ts';
import { fetchProductPhoto } from './api-client.ts';
import type { Product } from './catalog-model.ts';

export function ProductPhoto({session,product}:{session:Session;product:Product}) {
 const [url,setUrl]=useState<string|null>(null);
 useEffect(()=>{
  if(!product.hasPhoto){setUrl(null);return;}
  const controller=new AbortController();
  let objectUrl:string|null=null;
  void fetchProductPhoto(session,product.id,fetch,controller.signal).then(blob=>{
   if(controller.signal.aborted)return;
   objectUrl=URL.createObjectURL(blob);
   setUrl(objectUrl);
  }).catch(()=>{if(!controller.signal.aborted)setUrl(null);});
  return ()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[session,product.id,product.hasPhoto]);
 if(!url)return <span className="photo-placeholder" aria-label="Fotografia não disponível">Sem foto</span>;
 return <img className="product-image" src={url} alt={'Fotografia de '+product.name} loading="lazy"/>;
}
