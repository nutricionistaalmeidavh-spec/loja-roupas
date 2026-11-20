import {useEffect,useRef,useState} from 'react';
import {restoredTourStep,shouldShowTour,tourStepsFor,tourStorageKey} from './tour-model.ts';
import type {TourPage} from './tour-model.ts';

function readFlag(key:string){
 try{return window.localStorage.getItem(key);}catch{return null;}
}
function saveFlag(key:string,value:string){
 try{window.localStorage.setItem(key,value);}catch{/* navegadores sem armazenamento continuam operando */}
}
export function FirstRunTour({storeId,roles,replayToken,onNavigate}:{
 storeId:string;roles:string[];replayToken:number;onNavigate:(page:TourPage)=>void;
}){
 const steps=tourStepsFor(roles);
 const key=tourStorageKey(storeId,roles);
 const [open,setOpen]=useState(()=>shouldShowTour(readFlag(key)));
 const [index,setIndex]=useState(()=>restoredTourStep(readFlag(key),steps.length));
 const [targetFound,setTargetFound]=useState(false);
 const titleRef=useRef<HTMLHeadingElement>(null);
 const navigatorRef=useRef(onNavigate);
 navigatorRef.current=onNavigate;
 const step=steps[index];
 useEffect(()=>{
  if(!replayToken)return;
  setIndex(0);setOpen(true);
 },[replayToken]);
 useEffect(()=>{if(open)saveFlag(key,'step:'+index);},[open,index,key]);
 useEffect(()=>{
  if(!open||!step)return;
  navigatorRef.current(step.page);
  let highlighted:Element|null=null;
  const raf=requestAnimationFrame(()=>{
   highlighted=document.querySelector('[data-tour="'+step.target+'"]');
   if(!highlighted&&step.target==='cart')highlighted=document.querySelector('[data-tour="mobile-cart"]');
   if(highlighted){highlighted.setAttribute('data-tour-active','true');highlighted.scrollIntoView({block:'nearest',behavior:'instant'});}
   setTargetFound(Boolean(highlighted));
   titleRef.current?.focus();
  });
  return ()=>{cancelAnimationFrame(raf);highlighted?.removeAttribute('data-tour-active');};
 },[open,index,storeId]);
 useEffect(()=>{
  if(!open)return;
  const escape=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();saveFlag(key,'skipped');setOpen(false);}
  };
  document.addEventListener('keydown',escape);
  return ()=>document.removeEventListener('keydown',escape);
 },[open,key]);
 function close(result:'complete'|'skipped'){saveFlag(key,result);setOpen(false);}
 if(!open||!step)return null;
 return <section className="tour-card" role="dialog" aria-modal="false" aria-label="Guia inicial da loja">
  <div className="tour-top"><span className="tour-label">PRIMEIRO ACESSO</span>
   <button type="button" className="tour-dismiss" onClick={()=>close('skipped')} aria-label="Pular tour">Pular tour</button>
  </div>
  <div className="tour-progress"><span>Passo {index+1} de {steps.length}</span>
   <progress max={steps.length} value={index+1} aria-label="Progresso do tour"/>
  </div>
  <h2 tabIndex={-1} ref={titleRef}>{step.title}</h2>
  <p>{step.description}</p>
  {!targetFound&&<p className="tour-help">Esta seção pode não estar visível na tela atual. Use o menu da loja para acessá-la.</p>}
  <div className="tour-actions">
   <button type="button" className="light-button" disabled={index===0} onClick={()=>setIndex(n=>n-1)}>Voltar</button>
   {index===steps.length-1
    ?<button type="button" className="primary-action" onClick={()=>close('complete')}>Concluir tour</button>
    :<button type="button" className="primary-action" onClick={()=>setIndex(n=>n+1)}>Próximo</button>}
  </div>
 </section>;
}
