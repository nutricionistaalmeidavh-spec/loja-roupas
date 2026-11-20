import {useEffect,useId,useRef} from 'react';
import type {ReactNode} from 'react';
export function AppDialog({title,onClose,children,wide=false,locked=false}:{
 title:string;onClose:()=>void;children:ReactNode;wide?:boolean;locked?:boolean;
}){
 const id=useId(),ref=useRef<HTMLElement>(null);
 const closeRef=useRef(onClose);closeRef.current=onClose;
 const lockedRef=useRef(locked);lockedRef.current=locked;
 useEffect(()=>{
  const before=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const dialog=ref.current;
  dialog?.focus();
  const previousOverflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  function onKey(event:KeyboardEvent){
   if(event.key==='Escape'){event.preventDefault();if(!lockedRef.current)closeRef.current();return;}
   if(event.key!=='Tab'||!dialog)return;
   const els=[...dialog.querySelectorAll<HTMLElement>(
    'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'
   )].filter(el=>el.getClientRects().length>0);
   if(!els.length){event.preventDefault();dialog.focus();return;}
   const first=els[0],last=els[els.length-1];
   if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){
    event.preventDefault();last.focus();
   }else if(!event.shiftKey&&document.activeElement===last){
    event.preventDefault();first.focus();
   }
  }
  document.addEventListener('keydown',onKey);
  return ()=>{
   document.removeEventListener('keydown',onKey);
   document.body.style.overflow=previousOverflow;
   before?.focus();
  };
 },[]);
 return <div className="app-dialog-backdrop" role="presentation">
  <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={id}
   className={'app-dialog '+(wide?'app-dialog-wide':'')}>
   <header className="app-dialog-header">
    <h2 id={id}>{title}</h2>
    <button type="button" className="light-button" onClick={onClose} disabled={locked} aria-label={'Fechar '+title}>Fechar</button>
   </header>
   <div className="app-dialog-content">{children}</div>
  </section>
 </div>;
}
