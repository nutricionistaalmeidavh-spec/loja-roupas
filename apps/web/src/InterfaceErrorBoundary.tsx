import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

type Props={children:ReactNode};
type State={failed:boolean};

/**
 * React render failures must not unmount the entire application into an
 * empty viewport. Keep recovery local and never modify PostgreSQL data.
 */
export class InterfaceErrorBoundary extends Component<Props,State>{
 state:State={failed:false};

 static getDerivedStateFromError():State{
  return {failed:true};
 }

 componentDidCatch(error:Error,_info:ErrorInfo){
  // Never transmit error messages, stack traces or user content from the UI.
  console.error('LOJA_UI_RENDER_ERROR',error.name);
  void window.lojaDiagnostics?.renderFailure().catch(()=>{});
 }

 render(){
  if(!this.state.failed)return this.props.children;
  return <main role="alert" style={{
   maxWidth:520,margin:'10vh auto',padding:32,borderRadius:18,
   background:'#fff',border:'1px solid #e4e4e4',
   fontFamily:'system-ui, Segoe UI, sans-serif',lineHeight:1.6,color:'#242424'
  }}>
   <p style={{fontSize:12,letterSpacing:1.4,fontWeight:700}}>LOJA DE ROUPAS · RECUPERAÇÃO</p>
   <h1>Não foi possível mostrar a loja</h1>
   <p>Ocorreu uma falha na interface. Os dados salvos no PostgreSQL não foram apagados.</p>
   <button type="button" onClick={()=>window.location.reload()}
    style={{cursor:'pointer',border:0,borderRadius:8,padding:'12px 20px',
     color:'#fff',background:'#242424',fontWeight:700}}>
    Recarregar interface
   </button>
   <p style={{fontSize:13,color:'#6d6d6d'}}>Se continuar, feche e abra o aplicativo. No Windows, consulte o arquivo interface-diagnostics.log na pasta de dados do aplicativo.</p>
  </main>;
 }
}

declare global {
 interface Window { lojaDiagnostics?:{renderFailure:()=>Promise<boolean>}; }
}
