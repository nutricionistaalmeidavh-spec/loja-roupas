import { useEffect, useRef, useState } from 'react';
declare global{interface Window{lojaPrinter?:{
 list():Promise<Array<{name:string;displayName:string;isDefault:boolean}>>;
 print(request:{deviceName:string;paperMm:58|80}):Promise<{submitted:boolean}>;
}}}
import type { FormEvent } from 'react';
import { ApiError, headers, jsonRequest } from './api-client.ts';
import type { Session } from './api-client.ts';
import { CashReturnForm } from './CashReturnForm.tsx';
import { OperationalPanels } from './OperationalPanels.tsx';
import { OperationsActionCenter } from './OperationsActionCenter.tsx';
import { CommercialIntelligence } from './CommercialIntelligence.tsx';
import { PickupSettings, PickupTracking, usePickupSubmission } from './PickupOrders.tsx';
import { requestId } from './request-id.ts';
import { TaskDialog } from './TaskDialog.tsx';
import {SalesBars,RetailEmpty} from './RetailUI.tsx';
import {MarketplaceSyncPanel} from './MarketplaceSyncPanel.tsx';
import {ManagementFinance} from './ManagementFinance.tsx';
import {ManagementCustomers} from './ManagementCustomers.tsx';
import {ManagementInventory} from './ManagementInventory.tsx';
import {RetailLedger} from './RetailLedger.tsx';
import {RetailAfterSales} from './RetailAfterSales.tsx';
import {ManagementUsers} from './ManagementUsers.tsx';
import {BatchPurchaseForm} from './BatchPurchaseForm.tsx';
import {CashHistory} from './CashHistory.tsx';
import {QuarantinePanel} from './QuarantinePanel.tsx';

const currency = new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'});
const money = (cents:string) => currency.format(Number(cents)/100);
const message = (error:unknown) => error instanceof Error ? error.message : 'Falha na operação';
type Day = {day:string; sale_count:number; gross_cents:string; refunded_cents:string};
type Supplier = {id:string; name:string};
type Item = {id:string; name:string; color:string; size:string; price_cents:string; available:boolean; photo_url:string|null};

export function StoreOperations({session,cashId,onReturned}:{session:Session;cashId:string|null;onReturned:()=>void}) {
  const [refresh,setRefresh] = useState(0);
  const [section,setSection] = useState<'vendas'|'fornecedores'|'posvenda'|'operacoes'|'inteligencia'|'vitrine'|'financeiro'|'clientes'|'inventario'|'caixas'|'pessoas'>('vendas');
  const [supplierOpen,setSupplierOpen] = useState(false);
  const [returnOpen,setReturnOpen] = useState(false);
  const [returnLocked,setReturnLocked] = useState(false);
  const [days, setDays] = useState<Day[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const pending = useRef<{body:string; key:string} | null>(null);
  const storefront = '/vitrine/' + session.storeId;
  const [physical,setPhysical]=useState(true);
  useEffect(()=>{
   let mounted=true;
   void jsonRequest<{edition:'full'|'physical'}>('/v1/edition',{headers:headers(session)},fetch)
    .then(data=>{if(mounted)setPhysical(data.edition==='physical');})
    .catch(()=>{});
   return ()=>{mounted=false;};
  },[session]);
  useEffect(()=>{if(physical&&section==='vitrine')setSection('vendas');},[physical,section]);

  useEffect(() => {
    const controller = new AbortController();
    const init = {headers:headers(session), signal:controller.signal};
    void Promise.all([
      jsonRequest<{days:Day[]}>('/v1/management/sales-summary', init, fetch),
      jsonRequest<{suppliers:Supplier[]}>('/v1/management/suppliers', init, fetch),
    ]).then(([sales, inventory]) => {
      if (controller.signal.aborted) return;
      setDays(sales.days);
      setSuppliers(inventory.suppliers);
      setReady(true);
    }).catch(error => { if (!controller.signal.aborted) setError(message(error)); });
    return () => controller.abort();
  }, [session,refresh]);

  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setStatus('');
    setBusy(true);
    const body = JSON.stringify({name:name.trim()});
    const key = pending.current?.body === body ? pending.current.key : requestId();
    pending.current = {body,key};
    try {
      const supplier = await jsonRequest<Supplier>('/v1/management/suppliers', {
        method:'POST', headers:{...headers(session,key), 'content-type':'application/json'}, body,
      }, fetch);
      pending.current = null;
      setSuppliers(current => [...current.filter(item => item.id !== supplier.id), supplier]
        .sort((left,right) => left.name.localeCompare(right.name,'pt-BR')));
      setName('');
      setStatus('Fornecedor cadastrado.');
      setSupplierOpen(false);
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) pending.current = null;
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }

  const salesCount=days.reduce((sum,day)=>sum+Number(day.sale_count||0),0);
  const activeDays=days.filter(day=>Number(day.sale_count)>0).length;
  const sections=[
    {key:'vendas',label:'Vendas'},
    {key:'fornecedores',label:'Fornecedores'},
    {key:'posvenda',label:'Pós-venda'},
    {key:'operacoes',label:'Operações'},
    {key:'inteligencia',label:'Inteligência'},
    {key:'financeiro',label:'Financeiro'},
    {key:'caixas',label:'Caixas'},
    {key:'clientes',label:'Clientes'},
    {key:'inventario',label:'Inventário'},
    ...(!physical?[{key:'vitrine' as const,label:'Vitrine'}]:[]),
    ...(session.roles.includes('manager')?[{key:'pessoas' as const,label:'Pessoas e loja'}]:[]),
  ] as const;
  return <div className="operation-panel">
    <nav className="management-jump" aria-label="Atalhos da gestão">
      {sections.map(item=><a key={item.key} href={'#gestao-'+item.key}
        className={section===item.key?'active':''}
        aria-current={section===item.key?'page':undefined}
        onClick={event=>{event.preventDefault();setSection(item.key);}}>
        {item.label}
      </a>)}
    </nav>
    <OperationsActionCenter session={session} revision={refresh} onNavigate={setSection}/>
    {section==='vendas'&&<section id="gestao-vendas" className="management-section">
      <div className="management-section-head">
        <div><h2>Vendas e devoluções nos últimos 30 dias</h2><p>Informações registradas no servidor da loja.</p></div>
      </div>
      {!ready&&!error&&<p role="status" className="management-loading">Carregando resumo comercial…</p>}
      {error&&!ready&&<div role="alert" className="management-error"><p>{error}</p><button className="light-button" onClick={()=>{setError('');setRefresh(value=>value+1);}}>Tentar novamente</button></div>}
      {ready&&<div className="management-kpis" role="region" aria-label="Resumo da gestão">
        <div><span>Vendas registradas</span><strong>{salesCount.toLocaleString('pt-BR')}</strong><small>Últimos 30 dias</small></div>
        <div><span>Dias com vendas</span><strong>{activeDays}</strong><small>Dias no período</small></div>
        <div><span>Fornecedores cadastrados</span><strong>{suppliers.length}</strong><small>Base desta loja</small></div>
      </div>}
      {ready&&<SalesBars days={days}/>}
      {ready&&(days.length?<div className="management-table-scroll" role="region" aria-label="Histórico de vendas" tabIndex={0}>
        <table><thead><tr><th>Data</th><th>Vendas</th><th>Total bruto</th><th>Devoluções</th></tr></thead>
          <tbody>{days.map(day=><tr key={day.day}><td>{day.day.split('-').reverse().join('/')}</td>
            <td>{day.sale_count}</td><td>{money(day.gross_cents)}</td><td>{money(day.refunded_cents)}</td></tr>)}</tbody>
        </table>
      </div>:<RetailEmpty title="Nenhuma venda registrada" description="Assim que uma venda for confirmada no caixa, os indicadores aparecerão aqui."/>)}
    </section>}
    {section==='fornecedores'&&<section id="gestao-fornecedores" className="management-section">
      <div className="management-section-head">
        <div><h2>Fornecedores</h2><p>Cadastre e consulte os parceiros de abastecimento.</p></div>
        <button className="primary-action" disabled={!ready} onClick={()=>setSupplierOpen(true)}>Novo fornecedor</button>
      </div>
      {suppliers.length?<ul>{suppliers.map(supplier=><li key={supplier.id}>{supplier.name}</li>)}</ul>:
        <RetailEmpty title="Nenhum fornecedor cadastrado" description="Use Novo fornecedor para adicionar seu primeiro parceiro de abastecimento."/>}
    </section>}
    {section==='posvenda'&&<div id="gestao-posvenda" className="management-section management-surface">
      <div className="management-section-head">
        <div><h2>Pós-venda</h2><p>Trocas, devoluções, reservas e pedidos para retirada.</p></div>
        <button className="primary-action" onClick={()=>setReturnOpen(true)}>Nova devolução</button>
      </div>
      <RetailAfterSales session={session} cashId={cashId} onUpdated={()=>{setRefresh(n=>n+1);onReturned();}}/>
      <StockHolds session={session}/>
      {!physical&&<PickupSettings session={session}/>}
    </div>}
    {section==='operacoes'&&<div id="gestao-operacoes" className="management-section">
      <OperationalPanels session={session} suppliers={suppliers} onStockChanged={()=>{setRefresh(n=>n+1);onReturned();}}/>
      <BatchPurchaseForm session={session} suppliers={suppliers} onSaved={()=>setRefresh(n=>n+1)}/>
    </div>}
    {section==='inteligencia'&&<div id="gestao-inteligencia" data-tour="intelligence" className="management-section">
      <CommercialIntelligence session={session}/>
    </div>}
    {section==='financeiro'&&<><ManagementFinance session={session}/><RetailLedger session={session} cashId={cashId}/></>}
    {section==='clientes'&&<ManagementCustomers session={session}/>}
    {section==='inventario'&&<><ManagementInventory session={session} onSaved={()=>{setRefresh(n=>n+1);onReturned();}}/>
      <QuarantinePanel session={session} onChanged={()=>{setRefresh(n=>n+1);onReturned();}}/></>}
    {section==='caixas'&&<CashHistory session={session}/>}
    {section==='pessoas'&&<ManagementUsers session={session}/>}
    {section==='vitrine'&&!physical&&<section id="gestao-vitrine" data-tour="storefront" className="management-section">
      <h2>Vitrine online</h2><p>Abra a vitrine pública e confira como as peças aparecem para clientes.</p>
      <a href={storefront} target="_blank" rel="noreferrer">Abrir vitrine da loja</a>
      <MarketplaceSyncPanel session={session}/>
    </section>}
    {status&&<p role="status">{status}</p>}
    {error&&<p role="alert" className="error">{error}</p>}
    {supplierOpen&&<TaskDialog title="Novo fornecedor" busy={busy||Boolean(pending.current)}
      onClose={()=>setSupplierOpen(false)}>
      <form className="management-form" onSubmit={event=>void submit(event)}>
        <label>Nome do fornecedor<input required maxLength={120} value={name} disabled={busy}
          onChange={event=>setName(event.target.value)}/></label>
        {error&&<p className="error" role="alert">{error}</p>}
        <button className="primary-action" disabled={busy||!ready}>Cadastrar</button>
      </form>
    </TaskDialog>}
    {returnOpen&&<TaskDialog title="Registrar devolução" wide busy={returnLocked} onClose={()=>{if(!returnLocked)setReturnOpen(false);}}>
      <CashReturnForm session={session} cashId={cashId} onLockChange={setReturnLocked} onReturned={()=>{
        setRefresh(value=>value+1);
        onReturned();
      }}/>
    </TaskDialog>}
  </div>;
}

export function PublishVariant({session,id}:{session:Session;id:string}) {
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<{published:boolean; key:string} | null>(null);
  async function publish(published:boolean) {
    if (busy) return;
    setBusy(true);
    setFeedback('');
    const key = pending.current?.published === published ? pending.current.key : requestId();
    pending.current = {published,key};
    try {
      await jsonRequest('/v1/management/storefront/variants/' + id, {
        method:'PUT', headers:{...headers(session,key),'content-type':'application/json'},
        body:JSON.stringify({published}),
      }, fetch);
      pending.current = null;
      setFeedback(published ? 'Variação publicada.' : 'Variação retirada da vitrine.');
    } catch (error) {
      setFeedback(message(error));
    } finally {
      setBusy(false);
    }
  }
  return <div className="publication-actions">
    <button type="button" className="light-button" disabled={busy} onClick={() => void publish(true)}>Publicar na vitrine</button>
    <button type="button" className="light-button" disabled={busy} onClick={() => void publish(false)}>Retirar da vitrine</button>
    {feedback && <span role="status">{feedback}</span>}
  </div>;
}

export function Storefront({storeId}:{storeId:string}) {
  const [items, setItems] = useState<Item[]>([]);
  const [pickupEnabled,setPickupEnabled] = useState(false);
  const [basket,setBasket] = useState<Record<string,number>>({});
  const pickup = usePickupSubmission(storeId);
  const selected = items.filter(item => basket[item.id] > 0);
  const [cursor, setCursor] = useState<string|null>(null);
  const [page, setPage] = useState<string|null>(null);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const query = page ? '?after=' + encodeURIComponent(page) : '';
    void jsonRequest<{items:Item[];next:string|null;pickup_enabled:boolean}>('/v1/storefront/' + storeId + query,
      {signal:controller.signal}, fetch).then(result => {
        if (controller.signal.aborted) return;
        setItems(current => page ? [...current, ...result.items] : result.items);
        setCursor(result.next);
        setPickupEnabled(result.pickup_enabled);
      }).catch(error => {
        if (!controller.signal.aborted) setError(message(error));
      }).finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [storeId,page,retry]);
  return <main className="operation-panel storefront">
    <h1>Vitrine</h1>
    <ul>{items.map(item => <li key={item.id}>
      {item.photo_url && <img className="storefront-photo" src={item.photo_url} loading="lazy" alt=""/>}
      <strong>{item.name}</strong>
      <div>{item.color} · {item.size}</div><div>{money(item.price_cents)}</div>
      <small>{item.available ? 'Disponível' : 'Esgotado'}</small>
      {pickupEnabled && item.available && !pickup.order && <label className="pickup-quantity">
        Quantidade <input aria-label={'Quantidade de '+item.name+' '+item.color+' '+item.size}
          type="number" min={0} max={10} value={basket[item.id]??0} disabled={pickup.submitting}
          onChange={event => {
            const value = Math.min(10,Math.max(0,Math.trunc(Number(event.target.value) || 0)));
            setBasket(current => ({...current,[item.id]:value}));
          }}/>
      </label>}
    </li>)}</ul>
    {pickupEnabled && !pickup.order && selected.length>0 && <section>
      <h2>Pedido para retirada</h2>
      <p>Pagamento na loja. Preço e disponibilidade são conferidos no caixa.</p>
      <ul>{selected.map(item=><li key={item.id}>{basket[item.id]} × {item.name} · {item.color}/{item.size}</li>)}</ul>
      {selected.length>10 && <p role="alert">Envie até 10 variantes por pedido.</p>}
      <button className="primary-action" disabled={pickup.submitting || selected.length>10}
        onClick={()=>void pickup.submit(selected.map(item=>({variant_id:item.id,quantity:basket[item.id]})))}>
        Enviar pedido para retirada
      </button>
    </section>}
    {pickup.error && <p role="alert">{pickup.error}</p>}
    {pickup.order && <section role="status">
      <h2>Pedido recebido</h2>
      <p>Apresente este código em até 48 horas para consultar o pedido na loja.</p>
      <code className="pickup-code">{pickup.order.id}</code>
      <p>Total cotado {money(pickup.order.quoted_total_cents)}. As peças ficam separadas para você por 48 horas.</p>
    </section>}
    <PickupTracking key={pickup.order?.id ?? storeId} storeId={storeId} orderId={pickup.order?.id}/>
    {busy && <p role="status">Carregando vitrine…</p>}
    {!busy && !error && !items.length && <p>Nenhuma peça publicada.</p>}
    {error && <p role="alert">{error}</p>}
    {error ? <button className="light-button" onClick={() => {setError('');setBusy(true);setRetry(value=>value+1);}}>Tentar novamente</button>
      : cursor && <button className="light-button" disabled={busy} onClick={() => {setBusy(true);setPage(cursor);}}>Ver mais</button>}
  </main>;
}

export function PrintReceipt({session,id,ready}:{session:Session;id:string;ready:boolean}) {
  const [paper,setPaper] = useState<58|80>(80);
  const [printer,setPrinter]=useState('');
  const [devices,setDevices]=useState<Array<{name:string;displayName:string;isDefault:boolean}>>([]);
  useEffect(()=>{
   let alive=true;
   void window.lojaPrinter?.list().then(found=>{if(alive)setDevices(found);}).catch(()=>{});
   return ()=>{alive=false;};
  },[]);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const pending = useRef<{paper:58|80;key:string} | null>(null);
  async function print() {
    if (busy || !ready) return;
    setBusy(true);
    setError('');
    const key = pending.current?.paper === paper ? pending.current.key : requestId();
    pending.current = {paper,key};
    try {
      await jsonRequest('/v1/sales/' + id + '/print-requests', {
        method:'POST', headers:{...headers(session,key),'content-type':'application/json'},
        body:JSON.stringify({paper_mm:paper}),
      }, fetch);
      pending.current = null;
      document.documentElement.dataset.receiptPaper = String(paper);
      try {
        if(printer&&window.lojaPrinter)await window.lojaPrinter.print({deviceName:printer,paperMm:paper});
        else window.print();
      } finally { delete document.documentElement.dataset.receiptPaper; }
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return <div className="publication-actions">
    <label>Papel <select value={paper} disabled={busy} onChange={event => setPaper(event.target.value==='58'?58:80)}>
      <option value={58}>58 mm</option><option value={80}>80 mm</option>
    </select></label>
    {window.lojaPrinter&&<label>Impressora
      <select aria-label="Impressora do comprovante" value={printer} disabled={busy} onChange={event=>setPrinter(event.target.value)}>
       <option value="">Escolher na janela do Windows</option>
       {devices.map(device=><option key={device.name} value={device.name}>{device.displayName}{device.isDefault?' (padrão)':''}</option>)}
      </select></label>}
    <button className="light-button" disabled={!ready || busy} onClick={() => void print()}>Imprimir comprovante não fiscal</button>
    {error && <p role="alert" className="error">{error}</p>}
  </div>;
}

type Hold = {id:string; sku:string; quantity:number; stale:boolean; state:'active'|'released'; expires_at?:string};
export function StockHolds({session,variant,onChanged}:{
  session:Session; variant?:{id:string;sku:string}; onChanged?:()=>void;
}) {
  const [holds,setHolds] = useState<Hold[]>([]);
  const [quantity,setQuantity] = useState('1');
  const [hours,setHours] = useState('24');
  const [error,setError] = useState('');
  const [status,setStatus] = useState('');
  const [busy,setBusy] = useState(false);
  const [refresh,setRefresh] = useState(0);
  const pending = useRef(new Map<string,string>());
  useEffect(() => {
    if (variant) return;
    const controller = new AbortController();
    void jsonRequest<{holds:Hold[]}>('/v1/stock/holds', {headers:headers(session),signal:controller.signal},fetch)
      .then(result => { if (!controller.signal.aborted) setHolds(result.holds); })
      .catch(error => { if (!controller.signal.aborted) setError(message(error)); });
    return () => controller.abort();
  }, [session,variant,refresh]);

  async function change(id?:string) {
    if (busy) return;
    setBusy(true);
    setError('');
    setStatus('');
    const url = id ? '/v1/stock/holds/' + id + '/release' : '/v1/stock/holds';
    const body = id ? undefined : JSON.stringify({variant_id:variant!.id, quantity:Number(quantity), hours:Number(hours)});
    const signature = url + (body ?? '');
    const key = pending.current.get(signature) ?? requestId();
    pending.current.set(signature,key);
    try {
      await jsonRequest(url, {method:'POST', headers:{
        ...headers(session,key), ...(body ? {'content-type':'application/json'} : {}),
      }, body}, fetch);
      pending.current.delete(signature);
      setStatus(id ? 'Reserva liberada.' : 'Estoque reservado.');
      setRefresh(value=>value+1);
      onChanged?.();
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) pending.current.delete(signature);
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return <section>
    <h2>{variant ? 'Reservar estoque' : 'Reservas ativas'}</h2>
    {variant ? <form onSubmit={event => {event.preventDefault();void change();}}>
      <label>Quantidade de {variant.sku} <input type="number" min={1} max={999} required
        value={quantity} disabled={busy} onChange={event=>setQuantity(event.target.value)}/></label>
      <label>Validade <select value={hours} disabled={busy} onChange={event=>setHours(event.target.value)}>
        {[['4','4 horas'],['24','1 dia'],['48','2 dias'],['72','3 dias'],['168','7 dias']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
      </select></label>
      <button className="light-button" disabled={busy}>Reservar</button>
    </form> : <ul>{holds.map(hold => <li key={hold.id}>
      {hold.sku} · {hold.quantity} un. · {hold.expires_at&&<>vence {new Date(hold.expires_at).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})} · </>}
      {hold.stale&&<strong>Vence em breve ou está parada há mais de 1 dia: revisar</strong>}{' '}<button className="light-button" disabled={busy}
        onClick={() => void change(hold.id)}>Liberar reserva</button>
    </li>)}</ul>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
