import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {ApiError,headers,jsonRequest} from './api-client.ts';
import type {Session} from './api-client.ts';
import {requestId} from './request-id.ts';

type ProductField={id:string;label:string;value:string|null};

export function ProductFields({session,productId}:{session:Session;productId:string}) {
  const path='/v1/management/products/'+productId+'/fields';
  const [fields,setFields]=useState<ProductField[]>([]);
  const [feedback,setFeedback]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [revision,setRevision]=useState(0);
  const pending=useRef(new Map<string,string>());

  useEffect(()=>{
    const controller=new AbortController();
    void jsonRequest<{fields:ProductField[]}>(path,{headers:headers(session),signal:controller.signal},fetch)
      .then(result=>{if(!controller.signal.aborted)setFields(result.fields);})
      .catch(error=>{if(!controller.signal.aborted)setError((error as Error).message);});
    return ()=>controller.abort();
  },[session,path,revision]);

  async function submit(event:FormEvent<HTMLFormElement>,field?:ProductField) {
    event.preventDefault();
    if(busy)return;
    const form=event.currentTarget;
    const input=String(new FormData(form).get('field')).trim();
    const url=field?path+'/'+field.id:'/v1/management/product-fields';
    const body=JSON.stringify(field?{value:input}:{label:input});
    const signature=url+body;
    const key=pending.current.get(signature)??requestId();
    pending.current.set(signature,key);
    setBusy(true);setError('');setFeedback('');
    try{
      await jsonRequest(url,{method:field?'PUT':'POST',headers:{...headers(session,key),'content-type':'application/json'},body},fetch);
      pending.current.delete(signature);
      if(!field)form.reset();
      setFeedback(field?'Valor do campo salvo.':'Campo personalizado criado.');
      setRevision(value=>value+1);
    }catch(error){
      if(error instanceof ApiError&&error.status>=400&&error.status<500)pending.current.delete(signature);
      setError(error instanceof Error?error.message:'Falha ao salvar campo');
    }finally{setBusy(false);}
  }

  return <details className="editor-block">
    <summary>Campos personalizados</summary>
    <form onSubmit={event=>void submit(event)}>
      <label>Nome do campo <input name="field" required maxLength={60} disabled={busy}/></label>
      <button className="light-button" disabled={busy||fields.length>=12}>Adicionar campo</button>
    </form>
    {fields.map(field=><form key={field.id+':'+(field.value??'')} onSubmit={event=>void submit(event,field)}>
      <label>{field.label} <input name="field" maxLength={240} defaultValue={field.value??''} disabled={busy}/></label>
      <button className="light-button" disabled={busy}>Salvar {field.label}</button>
    </form>)}
    {feedback&&<p role="status">{feedback}</p>}
    {error&&<p role="alert" className="error">{error}</p>}
  </details>;
}
