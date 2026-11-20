import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, login } from './api-client.ts';
import type { LoginResult, Session } from './api-client.ts';

export function LoginScreen({onAuthenticated}:{onAuthenticated:(session:Session)=>void}) {
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [pending,setPending]=useState(false);
  const [error,setError]=useState('');
  const [result,setResult]=useState<LoginResult|null>(null);

  async function submit(event:FormEvent) {
    event.preventDefault();
    if(pending)return;
    setPending(true);setError('');
    try {
      const response=await login(username,password);
      setPassword('');
      if(!Array.isArray(response.stores)||!response.stores.length){
        setError('Seu usuário não tem loja autorizada. Consulte o gestor.');
        return;
      }
      if(response.stores.length===1) {
        onAuthenticated({token:response.token,storeId:response.stores[0].store_id,roles:response.stores[0].roles});
      } else setResult(response);
    } catch(err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível autenticar.');
    } finally { setPending(false); }
  }
  return <div className="login-shell"><section className="login-panel">
    <div className="login-logo">L</div>
    <p className="eyebrow">LOJA DE ROUPAS · SELF-HOSTED</p>
    <h1>Bem-vindo à sua loja</h1>
    <p className="muted">Entre com as credenciais criadas no servidor local. Não há conta em nuvem obrigatória.</p>
    {result?<div className="login-chooser">
      <h2>Escolher loja</h2>
      {result.stores.map(store=><button key={store.store_id} className="store-option" onClick={()=>onAuthenticated({
        token:result.token,storeId:store.store_id,roles:store.roles})}>
        Loja {store.store_id.slice(0,8)} · Continuar
      </button>)}
    </div>:<form onSubmit={event=>void submit(event)} className="login-form">
      <label>Usuário<input required autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} placeholder="Login do operador"/></label>
      <label>Senha<input type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Sua senha"/></label>
      {error&&<p className="error" role="alert">{error}</p>}
      <button className="primary-action" disabled={pending}>{pending?'Entrando…':'Entrar na loja'}</button>
    </form>}
    <p className="login-help">Primeiro acesso no Windows: abra o aplicativo instalado e siga o assistente para criar sua loja. Nenhuma instalação separada de banco ou Docker é necessária. Para Linux/servidor LAN, utilize o instalador local documentado.</p>
  </section></div>;
}
