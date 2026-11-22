import {Component} from 'react';
import type {ErrorInfo,ReactNode} from 'react';

type Props={children:ReactNode;scope:'app'|'estoque'};
type State={failed:boolean};

/** Um chunk corrompido/offline não pode desmontar o caixa nem deixar a janela branca. */
export class InterfaceRecovery extends Component<Props,State>{
 state:State={failed:false};
 static getDerivedStateFromError():State{return {failed:true};}
 componentDidCatch(error:Error,info:ErrorInfo){
  console.error('Falha na interface '+this.props.scope,error,info.componentStack);
 }
 render(){
  if(!this.state.failed)return this.props.children;
  const estoque=this.props.scope==='estoque';
  return <section className="interface-recovery" role="alert" style={{
    margin:'24px auto',padding:32,maxWidth:640,background:'#fff',
    border:'1px solid #e3ded6',borderRadius:16,color:'#2a2928'
  }}>
   <h2>{estoque?'Não foi possível abrir o estoque':'Não foi possível carregar a loja'}</h2>
   <p>Um módulo da interface não carregou corretamente. Seus produtos, vendas e estoque permanecem salvos no banco de dados.</p>
   <p>Confira a conexão com o computador principal e recarregue a interface. Caso persista, feche e abra o aplicativo.</p>
   <button type="button" className="primary-action" onClick={()=>window.location.reload()}>Recarregar interface</button>
  </section>;
 }
}
