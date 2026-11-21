import { requestId } from './request-id.ts';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { addToDraft, draftTotalCents, resolveVariant } from '@loja/domain';
import type { DraftLine, Variant } from '@loja/domain';
import { ApiError, listCatalog, listCategories, lookupDraftVariants, scanCatalog, revokeSession } from './api-client.ts';
import type { Session } from './api-client.ts';
import { mapCatalog } from './catalog-model.ts';
import type { Product } from './catalog-model.ts';
import { LoginScreen } from './LoginScreen.tsx';
import { FirstRunTour } from './FirstRunTour.tsx';
import { UpdateSettings } from './DesktopUpdates.tsx';
import { colorSwatch } from './visual-colors.ts';
import { ReceiveStockForm } from './Management.tsx';
import { ProductsWorkspace } from './ProductsWorkspace.tsx';
import { TaskDialog } from './TaskDialog.tsx';
import { ProductPhoto } from './ProductPhoto.tsx';
import { UiIcon } from './UiIcon.tsx';
import { M2StockAdjustment } from './M2Admin.tsx';
import { PickupLookup } from './PickupOrders.tsx';
import type { PickupOrder } from './PickupOrders.tsx';
import { PrintReceipt, StoreOperations } from './StoreOperations.tsx';
import { CashPanel } from './CashPanel.tsx';
import { CheckoutDrawer } from './PosCheckout.tsx';
import { currentCash, receiptText, suspendSale, suspendedSales, resumeSale } from './pos-client.ts';
import type { CashState, Sale, SuspendedDraft } from './pos-client.ts';

const brl = (cents:number) => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
const sizesFor = (p:Product,color:string) => [...new Set(p.variants.filter(v=>v.color===color).map(v=>v.size))];
function Garment({kind}:{kind:Product['kind']}) {
  return <svg viewBox="0 0 120 120" role="img" aria-label="Ilustração de categoria; fotografia não cadastrada">
    {kind==='pants'?<path d="M37 15h46l-7 93H62L60 60l-3 48H43z" fill="currentColor"/>:
    kind==='bag'?<><rect x="24" y="50" width="72" height="55" rx="8" fill="currentColor"/><path d="M42 50Q42 12 60 12T78 50" fill="none" stroke="currentColor" strokeWidth="8"/></>:
    kind==='shoe'?<path d="M8 70Q30 60 40 35h23Q70 66 106 72l5 24H8z" fill="currentColor"/>:
    kind==='dress'?<path d="M44 13h32l8 25-13 9 25 62H24l25-62-13-9z" fill="currentColor"/>:
    kind==='skirt'?<path d="M40 18h40l20 90H20z" fill="currentColor"/>:
    kind==='generic'?<><rect x="24" y="22" width="72" height="76" rx="9" fill="none" stroke="currentColor" strokeWidth="4"/><path d="M37 76 51 60l13 14 13-22 10 17" stroke="currentColor" strokeWidth="4" fill="none"/><circle cx="47" cy="41" r="7" fill="currentColor"/></>:
    <path d="M37 13L10 37l14 24 13-10v57h46V51l13 10 14-24-27-24-12-4Q60 27 49 9z" fill="currentColor"/>}
  </svg>;
}
const InventorySpreadsheet=lazy(()=>import('./InventorySpreadsheet.tsx'));
type Page = 'pdv'|'produtos'|'estoque'|'caixa'|'gestao'|'configuracoes';
export function App() {
  const [session,setSession] = useState<Session|null>(null);
  const [page,setPage] = useState<Page>('pdv');
  const [tourReplay,setTourReplay] = useState(0);
  const [products,setProducts] = useState<Product[]>([]);
  const [allProducts,setAllProducts] = useState<Product[]>([]);
  const [cursor,setCursor] = useState<string|null>(null);
  const [paging,setPaging] = useState(false);
  const [stockSearch,setStockSearch] = useState('');
  const [stockAction,setStockAction] = useState<'receive'|'adjust'|null>(null);
  const [stockLocked,setStockLocked] = useState(false);
  const [cashState,setCashState] = useState<CashState|null>(null);
  const [cashRefresh,setCashRefresh] = useState(0);
  const [pickup,setPickup] = useState<PickupOrder>();
  const [checkoutOpen,setCheckoutOpen] = useState(false);
  const [lastSale,setLastSale] = useState<Sale|null>(null);
  const [receipt,setReceipt] = useState('');
  const [receiptError,setReceiptError] = useState('');
  const [savedDrafts,setSavedDrafts] = useState<SuspendedDraft[]>([]);
  const [draftRefresh,setDraftRefresh] = useState(0);
  const [suspendPending,setSuspendPending] = useState<{key:string;body:string}|null>(null);
  const [suspendBusy,setSuspendBusy] = useState(false);
  const [search,setSearch] = useState('');
  const [debouncedSearch,setDebouncedSearch] = useState('');
  const [category,setCategory] = useState('Todos');
  const [categories,setCategories] = useState<string[]>(['Todos']);
  const [recoveryBusy,setRecoveryBusy] = useState(false);
  const cartDialogRef=useRef<HTMLElement>(null);
  const [selected,setSelected] = useState<Record<string,{color:string;size:string}>>({});
  const [draft,setDraft] = useState<DraftLine[]>([]);
  const [recoverable,setRecoverable] = useState<Array<{id:string;quantity:number}>>([]);
  const [hydratedDraftKey,setHydratedDraftKey] = useState<string|null>(null);
  const [message,setMessage] = useState('');
  const [cartFeedback,setCartFeedback] = useState('');
  const [catalogError,setCatalogError] = useState('');
  const [loading,setLoading] = useState(false);
  const [refetch,setRefetch] = useState(0);
  const [cartOpen,setCartOpen] = useState(false);
  const [scanBusy,setScanBusy] = useState(false);
  const [stockLoading,setStockLoading] = useState(false);
  const manager = session?.roles.includes('manager')??false;
  const canReceive = manager || (session?.roles.includes('stocker')??false);
  const canCash = manager || (session?.roles.includes('cashier')??false);
  const cashId = cashState?.active ? cashState.id : null;
  const filtered = products;
  const total = draftTotalCents(draft);
  const quantity = draft.reduce((sum,line)=>sum+line.quantity,0);
  const draftKey = session&&cashId ? 'loja:rascunho:'+session.storeId+':'+cashId : null;
  useEffect(()=>{
    if(!draftKey){setRecoverable([]);setHydratedDraftKey(null);return;}
    try{
      const stored=JSON.parse(sessionStorage.getItem(draftKey)||'[]') as Array<{id:string;quantity:number}>;
      setRecoverable(Array.isArray(stored)?stored.filter(x=>typeof x.id==='string'&&Number.isSafeInteger(x.quantity)&&x.quantity>0):[]);
      setHydratedDraftKey(draftKey);
    }catch{setRecoverable([]);setHydratedDraftKey(draftKey);}
  },[draftKey]);
  useEffect(()=>{
    if(!draftKey||hydratedDraftKey!==draftKey)return;
    if(draft.length){sessionStorage.setItem(draftKey,JSON.stringify(draft.map(x=>({id:x.variant.id,quantity:x.quantity}))));}
    else if(!recoverable.length){sessionStorage.removeItem(draftKey);}
  },[draft,draftKey,recoverable.length,hydratedDraftKey]);
  useEffect(()=>{
    if(!draft.length)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);
    return ()=>window.removeEventListener('beforeunload',warn);
  },[draft.length]);
  async function recoverDraft(){
    if(!session||!draftKey||draft.length||!recoverable.length||recoveryBusy)return;
    setRecoveryBusy(true);setMessage('');
    try{
      const catalog=mapCatalog(await lookupDraftVariants(session,recoverable.map(item=>item.id)));
      const variants=catalog.flatMap(p=>p.variants);
      const recovered=recoverable.flatMap(line=>{
        const variant=variants.find(v=>v.id===line.id);
        return variant?[{variant,quantity:line.quantity}]:[];
      });
      if(recovered.length!==recoverable.length){
        setMessage('Algumas peças foram removidas do catálogo. Revise o carrinho antes de recuperar.');
        return;
      }
      setDraft(recovered);setRecoverable([]);
      setMessage('Carrinho recuperado do servidor. Preços e estoque serão conferidos no checkout.');
    }catch(error){setMessage(error instanceof Error?error.message:'Não foi possível recuperar o carrinho.');}
    finally{setRecoveryBusy(false);}
  }

  useEffect(()=>{
    if(!session){setCategories(['Todos']);return;}
    const controller=new AbortController();
    void listCategories(session,fetch,controller.signal).then(result=>{
      if(!controller.signal.aborted)setCategories(['Todos',...result.categories]);
    }).catch(error=>{
      if(!controller.signal.aborted)setCatalogError(error instanceof Error?error.message:'Falha ao carregar categorias');
    });
    return ()=>controller.abort();
  },[session,refetch]);

  useEffect(()=>{
    if(!cartOpen)return;
    const dialog=cartDialogRef.current;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    dialog?.focus();
    function onKeyDown(event:globalThis.KeyboardEvent){
      if(event.key==='Escape'){event.preventDefault();setCartOpen(false);return;}
      if(event.key!=='Tab'||!dialog)return;
      const focusables=[...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])')]
        .filter(element=>element.getClientRects().length>0);
      if(!focusables.length){event.preventDefault();dialog.focus();return;}
      const first=focusables[0],last=focusables[focusables.length-1];
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
    document.addEventListener('keydown',onKeyDown);
    return ()=>{document.removeEventListener('keydown',onKeyDown);previous?.focus();};
  },[cartOpen]);

  useEffect(()=>{
    const timer=setTimeout(()=>setDebouncedSearch(search),250);
    return ()=>clearTimeout(timer);
  },[search]);
  useEffect(()=>{
    if(!session){setProducts([]);setCursor(null);return;}
    const controller=new AbortController();
    setLoading(true);setCatalogError('');
    void listCatalog(session,debouncedSearch,fetch,controller.signal,undefined,category==='Todos'?undefined:category)
      .then(data=>{if(!controller.signal.aborted){setProducts(mapCatalog(data));setCursor(data.next_cursor);}})
      .catch(error=>{
        if(controller.signal.aborted)return;
        setProducts([]);setCursor(null);
        setCatalogError(error instanceof Error?error.message:'Não foi possível carregar o catálogo');
        if(error instanceof ApiError&&error.status===401){setSession(null);setDraft([]);}
      })
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[session,debouncedSearch,refetch,category]);
  useEffect(()=>{
    if(!session||page!=='estoque'){setAllProducts([]);return;}
    const controller=new AbortController();
    setStockLoading(true);
    void listCatalog(session,stockSearch,fetch,controller.signal).then(data=>{
      if(!controller.signal.aborted)setAllProducts(mapCatalog(data));
    }).catch(error=>{
      if(!controller.signal.aborted){setAllProducts([]);setCatalogError(error instanceof Error?error.message:'Falha ao carregar estoque');}
    }).finally(()=>{if(!controller.signal.aborted)setStockLoading(false);});
    return ()=>controller.abort();
  },[session,page,refetch,stockSearch]);

  async function loadMore(){
    if(!session||!cursor||paging)return;
    setPaging(true);setCatalogError('');
    try{
      const data=await listCatalog(session,debouncedSearch,fetch,undefined,cursor,category==='Todos'?undefined:category);
      const appended=mapCatalog(data);
      setProducts(current=>{
        const ids=new Set(current.map(p=>p.id));
        return [...current,...appended.filter(p=>!ids.has(p.id))];
      });
      setCursor(data.next_cursor);
    }catch(error){setCatalogError(error instanceof Error?error.message:'Erro ao buscar próxima página');}
    finally{setPaging(false);}
  }
  useEffect(()=>{
    if(!session || !canCash){setCashState(null);return;}
    let cancelled=false;
    void currentCash(session).then(result=>{if(!cancelled)setCashState(result);})
      .catch(()=>{if(!cancelled)setCashState(null);});
    return ()=>{cancelled=true;};
  },[session,canCash,cashRefresh]);
  useEffect(()=>{
    if(!session||!cashId){setSavedDrafts([]);return;}
    let ignore=false;
    void suspendedSales(session).then(r=>{
      if(!ignore)setSavedDrafts(r.items.filter(d=>d.cash_session_id===cashId));
    }).catch(err=>{if(!ignore)setMessage(err instanceof Error?err.message:'Não foi possível ler vendas suspensas');});
    return ()=>{ignore=true;};
  },[session,cashId,draftRefresh]);
  async function suspendCurrent(){
    if(!session||!cashId||!draft.length||suspendBusy)return;
    const lines=draft.map(x=>({variant_id:x.variant.id,quantity:x.quantity}));
    const signature=JSON.stringify({cashId,lines});
    if(suspendPending&&suspendPending.body!==signature){setMessage('Suspensão pendente: repita com o carrinho anterior');return;}
    const key=suspendPending?.key??requestId();
    setSuspendPending({key,body:signature});setSuspendBusy(true);setMessage('');
    try{
      await suspendSale(session,cashId,lines,key);
      setSuspendPending(null);setDraft([]);setCartOpen(false);setDraftRefresh(x=>x+1);
      setMessage('Venda suspensa e salva no servidor. Não há reserva de estoque.');
    }catch(err){
      setMessage(err instanceof Error?err.message:'Falha ao suspender');
      if(err instanceof ApiError&&err.status>=400&&err.status<500)setSuspendPending(null);
    }finally{setSuspendBusy(false);}
  }
  async function resumeCurrent(item:SuspendedDraft){
    if(!session||!cashId||item.cash_session_id!==cashId)return;
    if(draft.length){setMessage('Limpe ou suspenda o carrinho atual antes de retomar outro.');return;}
    try{
      const resumed=await resumeSale(session,item.id,requestId());
      setDraft(resumed.lines.map(l=>({variant:l.variant,quantity:l.quantity})));
      setSavedDrafts(x=>x.filter(d=>d.id!==item.id));setMessage('Carrinho retomado. Preço e estoque serão revalidados antes de cobrar.');
    }catch(err){setMessage(err instanceof Error?err.message:'Não foi possível retomar');}
  }
  function cashUpdated(){setCashRefresh(n=>n+1);setDraftRefresh(n=>n+1);}
  function saleConfirmed(sale:Sale){
    if(!pickup){setDraft([]);setSelected({});}
    setPickup(undefined);setCheckoutOpen(false);setCartOpen(false);
    setLastSale(sale);setReceipt('');setReceiptError('');setRefetch(n=>n+1);
    if(session)void receiptText(session,sale.id).then(setReceipt).catch(error=>{
      setReceiptError(error instanceof Error?error.message:'Não foi possível obter o comprovante');
    });
  }
  function authenticated(value:Session){
    setSession(value);setDraft([]);setPage('pdv');setSearch('');setSelected({});setCategory('Todos');setCatalogError('');setMessage('');
  }
  function logout(){
    const active=session;
    setPickup(undefined);setCheckoutOpen(false);setSession(null);setDraft([]);setSelected({});setProducts([]);setAllProducts([]);setSearch('');setPage('pdv');setCashState(null);setLastSale(null);setReceipt('');setSavedDrafts([]);setSuspendPending(null);
    if(active)void revokeSession(active).catch(()=>{/* logout local é imediato; sessão remota expira conforme servidor */});
  }
  function selectVariant(product:Product,color:string,size:string){
    const sizes=sizesFor(product,color);
    setSelected(current=>({...current,[product.id]:{color,size:sizes.includes(size)?size:(sizes[0]??'')}}));
  }
  function addVariant(variant:Variant){
    try { setDraft(addToDraft(draft,variant));setMessage('');setCartFeedback('Peça adicionada ao carrinho: '+variant.sku); }
    catch(error){setMessage(error instanceof Error?error.message:'Não foi possível adicionar');}
  }
  async function scan(){
    if(!session||!search.trim()||scanBusy)return;
    setScanBusy(true);setMessage('');
    try{
      const page=mapCatalog(await scanCatalog(session,search));
      const code=search.trim().toUpperCase();
      const exact=page.flatMap(p=>p.variants).filter(v=>
        v.sku.toUpperCase()===code||(v.barcode??'').toUpperCase()===code);
      if(exact.length===1){addVariant(exact[0]);setSearch('');}
      else if(exact.length>1)setMessage('Código ambíguo. Selecione a variante no catálogo.');
      else setMessage('Nenhum SKU/código exato encontrado. Revise os resultados da pesquisa.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha na leitura de código');}
    finally{setScanBusy(false);}
  }
  function keySearch(event:KeyboardEvent<HTMLInputElement>){
    if(event.key==='Enter'){event.preventDefault();void scan();}
  }
  function setCurrentPage(value:Page){
    setPage(value);setMessage('');setCatalogError('');setCartOpen(false);
  }
  function refreshed(){setRefetch(n=>n+1);}
  if(!session)return <LoginScreen onAuthenticated={authenticated}/>;

  const operatorRole=session.roles.includes('manager')?'Gestor':session.roles.includes('cashier')?'Operador de caixa':session.roles.includes('stocker')?'Estoque':'Colaborador';
  const storeTitle=session.storeName?.trim()||'Sua loja';
  const cart = <div className="cart-content">
    <div className="cart-head"><h2>Carrinho</h2><button className="text-btn" disabled={!draft.length} onClick={()=>setDraft([])}>Limpar</button></div>
    <p className="muted">{quantity} {quantity===1?'peça adicionada':'peças adicionadas'}</p>
    {cartFeedback&&<p className="sr-only" role="status">{cartFeedback}</p>}
    <div className="cart-lines">{draft.length?draft.map(line=><div className="cart-line" key={line.variant.id}>
      <div className="mini-visual" aria-hidden="true"><UiIcon name="bag" size={22}/></div><div className="cart-description"><strong>{products.find(p=>p.variants.some(v=>v.id===line.variant.id))?.name??line.variant.sku}</strong>
      <span>{line.variant.color} · {line.variant.size} · {line.variant.sku}</span>
      <div className="qty"><button aria-label={'Diminuir '+line.variant.sku} onClick={()=>setDraft(draft.flatMap(x=>x.variant.id!==line.variant.id?[x]:x.quantity===1?[]:[{...x,quantity:x.quantity-1}]))}>−</button>
      <span>{line.quantity}</span><button aria-label={'Aumentar '+line.variant.sku} onClick={()=>addVariant(line.variant)}>+</button></div>
      </div><strong>{brl(line.quantity*line.variant.priceCents)}</strong>
    </div>):<p className="empty-cart">Seu carrinho ainda está vazio. Escolha produtos do catálogo.</p>}</div>
    <div className="cart-footer"><div className="total-row"><span>Subtotal estimado</span><strong>{brl(total)}</strong></div>
    <p className="muted small">Rascunho local, sem reserva de estoque. Preço e disponibilidade precisam ser confirmados no servidor.</p>
    <button className="light-button" disabled={!draft.length||!cashId||suspendBusy}
       onClick={()=>void suspendCurrent()}>{suspendBusy?'Salvando…':'Suspender venda'}</button>
    <button className="checkout-button" disabled={!draft.length||!cashId}
      onClick={()=>{setCartOpen(false);setCheckoutOpen(true);}}>
      {cashId?'Revisar e pagar':'Abra o caixa para vender'}</button></div>
  </div>;

  return <div className="shell">
    <nav className="icon-rail" aria-label="Navegação principal">
      <div className="logo">L</div>
      <button className={page==='pdv'?'active':''} onClick={()=>setCurrentPage('pdv')} aria-label="PDV" title="PDV"><UiIcon name="pos"/></button>
      {manager&&<button className={page==='produtos'?'active':''} onClick={()=>setCurrentPage('produtos')} aria-label="Cadastrar produtos" title="Produtos"><UiIcon name="shirt"/></button>}
      {canReceive&&<button className={page==='estoque'?'active':''} onClick={()=>setCurrentPage('estoque')} aria-label="Entrada de estoque" title="Estoque"><UiIcon name="boxes"/></button>}
      {canCash&&<button className={page==='caixa'?'active':''} onClick={()=>setCurrentPage('caixa')} aria-label="Caixa" title="Caixa"><UiIcon name="wallet"/></button>}
      {manager&&<button className={page==='gestao'?'active':''} onClick={()=>setCurrentPage('gestao')} aria-label="Gestão" title="Gestão"><UiIcon name="chart"/></button>}
      <button className={page==='configuracoes'?'active':''} onClick={()=>setCurrentPage('configuracoes')} aria-label="Configurações" title="Configurações"><UiIcon name="settings"/></button>
      <button className="exit" title="Sair" aria-label="Encerrar sessão" onClick={logout}><UiIcon name="logout"/></button>
    </nav>
    <main className="workspace">
      <header className="topbar" data-tour="overview">
        <div><h1>{page==='pdv'?'Nova venda':page==='produtos'?'Produtos':page==='caixa'?'Caixa':page==='gestao'?'Gestão':page==='configuracoes'?'Configurações':'Estoque'}</h1>
          <span>{storeTitle} · {operatorRole}</span></div>
        <div className="header-actions">
          <span className={catalogError?'demo-status disconnected':'demo-status'}>
            {catalogError?'Servidor indisponível':cashId?'Caixa aberto · Conectado':'Catálogo conectado · Sem caixa'}</span>
          <button className="help-tour" type="button" aria-label="Reabrir tour" onClick={()=>setTourReplay(n=>n+1)}>Ajuda · Tour</button>
          <button className="mobile-logout" onClick={logout}>Sair</button>
        </div>
      </header>
      <nav className="mobile-navigation" aria-label="Navegação da loja">
        <label htmlFor="mobile-page">Página</label>
        <select id="mobile-page" value={page} onChange={event=>setCurrentPage(event.target.value as Page)}>
          <option value="pdv">PDV</option>
          {manager&&<option value="produtos">Produtos</option>}
          {canReceive&&<option value="estoque">Estoque</option>}
          {canCash&&<option value="caixa">Caixa</option>}
          {manager&&<option value="gestao">Gestão</option>}
          <option value="configuracoes">Configurações</option>
        </select>
      </nav>
      {page==='pdv'&&<div className="work-area"><section className="products-area">
        <div className="heading"><h2>Selecionar produtos</h2><p>Dados reais por loja. Busca por nome, SKU ou código de barras.</p></div>
        {recoverable.length>0&&!draft.length&&<section className="suspended-bar" aria-label="Recuperação de carrinho"><strong>Há um carrinho interrompido ({recoverable.length} itens)</strong><button className="light-button" disabled={recoveryBusy} onClick={()=>void recoverDraft()}>{recoveryBusy?'Recuperando…':'Recuperar carrinho'}</button><button className="text-btn" onClick={()=>{if(draftKey)sessionStorage.removeItem(draftKey);setRecoverable([]);}}>Descartar</button></section>}
        {savedDrafts.length>0&&<section className="suspended-bar" aria-label="Vendas suspensas">
          <strong>Vendas suspensas ({savedDrafts.length})</strong>
          {savedDrafts.map(item=><button key={item.id} className="light-button"
            onClick={()=>void resumeCurrent(item)}>Retomar venda · {item.lines.length} itens</button>)}
        </section>}
        {cashId&&<PickupLookup session={session} onLoaded={order=>{setPickup(order);setCheckoutOpen(true);}}/>}
        <div className="search-row" data-tour="search"><label htmlFor="search" className="sr-only">Buscar nome, SKU ou código</label>
          <input id="search" value={search} autoComplete="off" onChange={e=>setSearch(e.target.value)} onKeyDown={keySearch} placeholder="Pesquisar produto, SKU ou código…"/>
          {search&&<button type="button" className="search-clear" aria-label="Limpar busca" onClick={()=>setSearch('')}><UiIcon name="x" size={16}/></button>}
          <button type="button" className="scan-button" disabled={scanBusy||!search.trim()} onClick={()=>void scan()}>{scanBusy?'Consultando…':'Confirmar código'}</button>
        </div>
        <div className="categories" role="group" aria-label="Categorias disponíveis">
          {categories.map(c=><button key={c} className={category===c?'chosen':''} aria-pressed={category===c} onClick={()=>setCategory(c)}>{c}</button>)}
        </div>
        {message&&<p role="alert" className="error">{message}</p>}
        {catalogError&&<div className="error" role="alert">{catalogError} <button onClick={refreshed}>Tentar novamente</button></div>}
        {loading&&<p className="notice" role="status">Carregando produtos da loja…</p>}
        {!loading&&!catalogError&&<div className="product-grid" data-tour="variants">
          {filtered.map(p=>{
            const colors=[...new Set(p.variants.map(v=>v.color))];
            const choice=selected[p.id],color=choice?.color??colors[0]??'';
            const sizes=sizesFor(p,color),size=choice?.size&&sizes.includes(choice.size)?choice.size:sizes[0]??'';
            const selectedVariant=resolveVariant(p.variants,color,size);
            const ready=Boolean(choice)||p.variants.length===1;
            return <article key={p.id} className="product-card">
              <div data-kind={p.kind} className={'product-visual '+p.kind}>{p.hasPhoto?<ProductPhoto session={session} product={p}/>:<div className="garment-placeholder"><Garment kind={p.kind}/><span>Foto não cadastrada</span></div>}</div>
              <div className="card-copy">
                <h3 title={p.name}>{p.name}</h3>
                <p className="price">{selectedVariant?brl(selectedVariant.priceCents):'Indisponível'}</p>
                <div className="sizes" role="group" aria-label={'Tamanhos de '+p.name}>
                  {sizes.map(s=><button key={s} type="button" aria-pressed={ready&&size===s} className={ready&&size===s?'selected':''} onClick={()=>selectVariant(p,color,s)}>{s}</button>)}
                </div>
                <div className="card-bottom">
                  <div className="swatches" role="group" aria-label={'Cores de '+p.name}>
                    {colors.map(c=>{const visual=colorSwatch(c);return <button type="button" key={c} aria-label={'Selecionar cor '+c} aria-pressed={ready&&color===c}
                      title={c} className={ready&&color===c?'selected':''} onClick={()=>selectVariant(p,c,size)}>
                      <span className={'swatch'+(!visual.known?' unknown':'')} style={{backgroundColor:visual.background}}>{visual.label}</span></button>;})}
                  </div>
                  <button className="add" aria-label={'Adicionar '+p.name} disabled={!ready||!selectedVariant||selectedVariant.available===0}
                    onClick={()=>{if(selectedVariant)addVariant(selectedVariant);}}><UiIcon name="plus" size={15}/><span>Adicionar</span></button>
                </div>
                <p className="stock-hint">{!ready?'Selecione cor e tamanho':selectedVariant?.available?selectedVariant.available+' disponíveis':'Sem estoque para esta variante'}</p>
              </div>
            </article>;
          })}
          {!filtered.length&&<p className="empty-catalog">Nenhuma peça disponível para estes filtros. Cadastre produtos ou altere a busca.</p>}
        </div>}
        {cursor&&<button className="light-button" disabled={paging} onClick={()=>void loadMore()}>{paging?'Carregando…':'Carregar mais produtos'}</button>}
        <p className="muted small">Catálogo real e fotografias privadas no servidor local. Atualize a busca para localizar SKU de outras páginas.</p>
      </section><aside data-tour="cart" className="cart-panel" aria-label="Carrinho da venda">{cart}</aside></div>}
      {page==='gestao'&&manager&&<div data-tour="management"><StoreOperations session={session} cashId={cashId} onReturned={refreshed}/></div>}
      {page==='configuracoes'&&<UpdateSettings/>}
      {page==='produtos'&&manager&&<div data-tour="products"><ProductsWorkspace session={session} onSaved={refreshed}/></div>}
      {page==='caixa'&&canCash&&<div data-tour="cash"><CashPanel session={session} onChanged={cashUpdated}/></div>}
      {page==='estoque'&&canReceive&&<div className="products-workspace" data-tour="stock">
        <section className="workspace-hero">
          <div><h2>Estoque da loja</h2><p>Consulte e registre movimentações apenas quando necessário.</p></div>
          <div className="workspace-actions">
            <button className="primary-action" onClick={()=>setStockAction('receive')}>Receber estoque</button>
            {manager&&<button className="light-button" onClick={()=>setStockAction('adjust')}>Ajustar estoque</button>}
          </div>
        </section>
        <Suspense fallback={<p role="status">Carregando planilha de estoque…</p>}>
          <InventorySpreadsheet session={session} onSaved={refreshed}
            canEdit={manager} canReceive={canReceive}/>
        </Suspense>
      </div>}
    </main>
    {page==='estoque'&&canReceive&&stockAction==='receive'&&<TaskDialog title="Receber estoque" wide busy={stockLocked}
      onClose={()=>setStockAction(null)}>
      <div className="stock-task-layout">
        <div className="management-form">
          <label>Localizar peça para recebimento (nome ou SKU)
            <input value={stockSearch} onChange={e=>setStockSearch(e.target.value)} placeholder="Buscar no servidor"/>
          </label>
          {stockLoading&&<p className="notice">Carregando variantes para recebimento…</p>}
          <p className="muted small">Mostrando até 50 resultados; pesquise o SKU exato para outros itens.</p>
        </div>
        <ReceiveStockForm session={session} products={allProducts} onSaved={refreshed} onLockChange={setStockLocked}/>
      </div>
    </TaskDialog>}
    {page==='estoque'&&manager&&stockAction==='adjust'&&<TaskDialog title="Ajustar estoque" wide busy={stockLocked}
      onClose={()=>setStockAction(null)}>
      <M2StockAdjustment session={session} onSaved={refreshed} refreshKey={refetch} onLockChange={setStockLocked}/>
    </TaskDialog>}
    {page==='pdv'&&<button data-tour="mobile-cart" className="mobile-cart" onClick={()=>setCartOpen(true)}>Ver carrinho · {quantity} peças · {brl(total)}</button>}
    {checkoutOpen&&cashId&&<CheckoutDrawer session={session} cashSessionId={cashId}
      draft={draft} pickup={pickup} onClose={()=>{setPickup(undefined);setCheckoutOpen(false);}} onConfirmed={saleConfirmed}/>}
    {lastSale&&<div className="checkout-overlay" role="presentation">
      <section className="checkout-modal" role="dialog" aria-modal="true" aria-label="Venda confirmada">
        <h2>Venda #{lastSale.sale_number} confirmada</h2>
        <p className="notice" role="status">Venda registrada e estoque atualizado.</p>
        <p>Total: {brl(lastSale.total_cents)} · Troco: {brl(lastSale.change_cents)}</p>
        {receipt&&<pre className="receipt-print">{receipt}</pre>}
        {receiptError&&<p role="alert" className="error">{receiptError}</p>}
        <div className="checkout-buttons">
          <PrintReceipt key={lastSale.id} id={lastSale.id} session={session} ready={Boolean(receipt)}/>
          <button className="primary-action" onClick={()=>{setLastSale(null);setReceipt('');}}>Nova venda</button>
        </div>
      </section>
    </div>}
    <FirstRunTour key={session.storeId+session.roles.join(',')} storeId={session.storeId} roles={session.roles} replayToken={tourReplay} suspended={checkoutOpen||cartOpen||Boolean(lastSale)||Boolean(stockAction)} onNavigate={setCurrentPage}/>
    {page==='pdv'&&cartOpen&&<div className="drawer-backdrop" onMouseDown={()=>setCartOpen(false)}>
      <aside ref={cartDialogRef} tabIndex={-1} className="mobile-drawer" role="dialog" aria-modal="true" aria-label="Carrinho" onMouseDown={e=>e.stopPropagation()}>
        <button className="close-drawer" onClick={()=>setCartOpen(false)}>Fechar ×</button>{cart}
      </aside></div>}
  </div>;
}
