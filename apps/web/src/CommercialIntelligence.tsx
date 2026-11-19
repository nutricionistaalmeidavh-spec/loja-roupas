import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {ApiError,headers,jsonRequest,listCatalog} from './api-client.ts';
import type {Session} from './api-client.ts';
import {reaisToCents} from './catalog-model.ts';
import {requestId} from './request-id.ts';

const route='/v1/management/intelligence';
const widgets={seasonality:'Sazonalidade',collections:'Coleções',suppliers:'Fornecedores',stock:'Estoque baixo'};
type Widget=keyof typeof widgets;
type Preferences={target_cents:number;low_stock_limit:number;widgets:Widget[]};
type Period={period:string;gross_cents:string;refunded_cents:string};
type Dashboard={
  preferences:Preferences;months:Period[];
  forecast:{active_days:number;estimate_cents:string|null;low_cents:string|null;high_cents:string|null};
  collections:Array<{name:string;units:string;revenue_cents:string}>;
  suppliers:Array<{id:string;name:string;orders:number;received:number;average_days:string|null}>;
  low_stock:Array<{id:string;sku:string;name:string;available:string}>;
};
const brl=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const money=(value:string|number|bigint)=>brl.format(Number(value)/100);
const getNet=(period:Period)=>BigInt(period.gross_cents)-BigInt(period.refunded_cents);
const errorText=(error:unknown)=>error instanceof Error?error.message:'Falha ao consultar inteligência comercial';

export function CommercialIntelligence({session}:{session:Session}) {
  const [data,setData]=useState<Dashboard|null>(null);
  const [query,setQuery]=useState('');
  const [products,setProducts]=useState<Array<{id:string;name:string}>>([]);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [refresh,setRefresh]=useState(0);
  const pending=useRef(new Map<string,string>());

  useEffect(()=>{
    const controller=new AbortController();
    void jsonRequest<Dashboard>(route,{headers:headers(session),signal:controller.signal},fetch)
      .then(result=>{if(!controller.signal.aborted)setData(result);})
      .catch(error=>{if(!controller.signal.aborted)setError(errorText(error));});
    return ()=>controller.abort();
  },[session,refresh]);

  useEffect(()=>{
    const controller=new AbortController();
    const timer=window.setTimeout(()=>{
      if(!query.trim()){setProducts([]);return;}
      void listCatalog(session,query,fetch,controller.signal).then(result=>{
        if(!controller.signal.aborted)setProducts(result.items.map(({id,name})=>({id,name})));
      }).catch(error=>{if(!controller.signal.aborted)setError(errorText(error));});
    },250);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[session,query]);

  async function save(url:string,value:unknown,notice:string) {
    if(busy)return;
    setBusy(true);setError('');setNotice('');
    const body=JSON.stringify(value),signature=url+body;
    const key=pending.current.get(signature)??requestId();
    pending.current.set(signature,key);
    try{
      await jsonRequest(url,{method:'PUT',headers:{...headers(session,key),'content-type':'application/json'},body},fetch);
      pending.current.delete(signature);
      setNotice(notice);setRefresh(value=>value+1);
    }catch(error){
      if(error instanceof ApiError && error.status>=400 && error.status<500)pending.current.delete(signature);
      setError(errorText(error));
    }finally{setBusy(false);}
  }

  function savePreferences(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    try{
      void save(route,{target_cents:reaisToCents(String(form.get('target'))),
        low_stock_limit:Number(form.get('limit')),widgets:form.getAll('widgets')},'Preferências salvas.');
    }catch(error){setError(errorText(error));}
  }

  function saveCollection(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    void save(route+'/products/'+String(form.get('product'))+'/collection',
      {collection:String(form.get('collection')).trim()},'Coleção atualizada.');
  }

  const month=data?.months.at(-1);
  const prefs=data?.preferences;
  const forecast=data?.forecast;
  return <section className="commercial-intelligence">
    <h2>Inteligência comercial</h2>
    {!data&&!error&&<p role="status">Calculando indicadores…</p>}
    {month&&prefs&&forecast&&<>
      <dl className="intelligence-summary">
        <div><dt>Vendas líquidas do mês</dt><dd>{money(getNet(month))}</dd></div>
        <div><dt>Meta mensal</dt><dd>{prefs.target_cents>0?money(prefs.target_cents):'A definir'}</dd></div>
        {prefs.target_cents>0&&<div><dt>Diferença para a meta</dt>
          <dd>{money(BigInt(prefs.target_cents)-getNet(month))}</dd></div>}
        <div><dt>Estimativa dos próximos 14 dias</dt>
          <dd>{forecast.estimate_cents===null?'Histórico insuficiente':money(forecast.estimate_cents)}</dd></div>
      </dl>
      <p>{forecast.active_days} de 28 dias completos com vendas. A projeção usa o ritmo líquido desse período e exige ao menos sete dias com vendas.</p>
      {forecast.low_cents!==null&&forecast.high_cents!==null&&<p>Faixa observada entre as duas quinzenas de {money(forecast.low_cents)} a {money(forecast.high_cents)}.</p>}
      <details>
        <summary>Personalizar painel</summary>
        <form onSubmit={savePreferences} key={JSON.stringify(prefs)}>
          <label>Meta mensal (R$) <input name="target" inputMode="decimal" required defaultValue={(prefs.target_cents/100).toFixed(2).replace('.',',')}/></label>
          <label>Limite de estoque baixo <input name="limit" type="number" min={0} max={999} required defaultValue={prefs.low_stock_limit}/></label>
          <fieldset><legend>Indicadores visíveis</legend>
            {(Object.keys(widgets) as Widget[]).map(widget=><label key={widget}>
              <input type="checkbox" name="widgets" value={widget} defaultChecked={prefs.widgets.includes(widget)}/> {widgets[widget]}
            </label>)}
          </fieldset>
          <button className="primary-action" disabled={busy}>Salvar preferências</button>
        </form>
      </details>
      {prefs.widgets.includes('seasonality')&&<details>
        <summary>Sazonalidade mensal</summary>
        <table><thead><tr><th scope="col">Mês</th><th scope="col">Vendas</th><th scope="col">Devoluções</th><th scope="col">Líquido</th></tr></thead>
          <tbody>{data.months.map(period=><tr key={period.period}><td>{period.period.slice(0,7).split('-').reverse().join('/')}</td>
            <td>{money(period.gross_cents)}</td><td>{money(period.refunded_cents)}</td><td>{money(getNet(period))}</td></tr>)}</tbody>
        </table>
      </details>}
      {prefs.widgets.includes('collections')&&<details>
        <summary>Vendas por coleção</summary>
        <p>Vendas confirmadas nos últimos 90 dias, agrupadas pela coleção atual das peças.</p>
        <ul>{data.collections.map(collection=><li key={collection.name}>{collection.name} · {collection.units} un. · {money(collection.revenue_cents)}</li>)}</ul>
        <form onSubmit={saveCollection}>
          <label>Buscar produto para coleção <input value={query} onChange={e=>setQuery(e.target.value)}/></label>
          <label>Produto da coleção <select aria-label="Produto da coleção" name="product" required defaultValue="">
            <option value="">Selecione</option>{products.map(product=><option key={product.id} value={product.id}>{product.name}</option>)}
          </select></label>
          <label>Nome da coleção <input name="collection" maxLength={80} placeholder="Deixe vazio para remover"/></label>
          <button className="primary-action" disabled={busy}>Salvar coleção</button>
        </form>
      </details>}
      {prefs.widgets.includes('suppliers')&&<details>
        <summary>Desempenho de fornecedores</summary>
        <p>Pedidos dos últimos 90 dias. O prazo médio requer três recebimentos.</p>
        <ul>{data.suppliers.map(supplier=><li key={supplier.id}>{supplier.name} · {supplier.received}/{supplier.orders} recebidos · {
          supplier.average_days===null?'Amostra insuficiente':supplier.average_days.replace('.',',')+' dias em média'}</li>)}</ul>
      </details>}
      {prefs.widgets.includes('stock')&&<details>
        <summary>Estoque baixo ({data.low_stock.length})</summary>
        <p>Até 30 variantes com saldo disponível igual ou abaixo de {prefs.low_stock_limit}.</p>
        <ul>{data.low_stock.map(item=><li key={item.id}>{item.name} · {item.sku} · {item.available} disponíveis</li>)}</ul>
      </details>}
    </>}
    {notice&&<p role="status">{notice}</p>}
    {error&&<p role="alert" className="error">{error} <button className="light-button" onClick={()=>{setError('');setRefresh(value=>value+1);}}>Atualizar indicadores</button></p>}
  </section>;
}
