import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

/** Primitiva única de janela para fluxos operacionais de curta duração. */
export function TaskDialog({title,onClose,children,busy=false,wide=false}:{
  title:string;onClose:()=>void;children:ReactNode;busy?:boolean;wide?:boolean;
}){
  const labelId=useId();
  const surface=useRef<HTMLElement>(null);
  const onCloseRef=useRef(onClose);
  const busyRef=useRef(busy);
  onCloseRef.current=onClose;
  busyRef.current=busy;
  useEffect(()=>{
    const old=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const root=surface.current;
    root?.focus();
    function keyboard(event:KeyboardEvent){
      if(event.key==='Escape'){
        if(!busyRef.current){event.preventDefault();onCloseRef.current();}
        return;
      }
      if(event.key!=='Tab'||!root)return;
      const focusables=[...root.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])'
      )].filter(item=>item.getClientRects().length>0);
      if(!focusables.length){event.preventDefault();root.focus();return;}
      if(event.shiftKey&&(document.activeElement===focusables[0]||document.activeElement===root)){
        event.preventDefault();focusables[focusables.length-1].focus();
      }else if(!event.shiftKey&&document.activeElement===focusables[focusables.length-1]){
        event.preventDefault();focusables[0].focus();
      }
    }
    document.addEventListener('keydown',keyboard);
    return ()=>{document.removeEventListener('keydown',keyboard);old?.focus();};
  },[]);
  return <div className="task-dialog-backdrop"
    onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
    <section ref={surface} tabIndex={-1} role="dialog" aria-modal="true"
      aria-labelledby={labelId} className={'task-dialog'+(wide?' task-dialog-wide':'')}>
      <header className="task-dialog-head">
        <h2 id={labelId}>{title}</h2>
        <button type="button" className="light-button" onClick={onClose} disabled={busy} aria-label={'Fechar '+title}>Fechar</button>
      </header>
      <div className="task-dialog-body">{children}</div>
    </section>
  </div>;
}
