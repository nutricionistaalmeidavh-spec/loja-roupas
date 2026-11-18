import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { addToDraft, draftTotalCents, resolveVariant } from '@loja/domain';
import type { DraftLine, Variant } from '@loja/domain';
import { ApiError, listCatalog, revokeSession } from './api-client.ts';
import type { Session } from './api-client.ts';
import { mapCatalog } from './catalog-model.ts';
import type { Product } from './catalog-model.ts';
import { LoginScreen } from './LoginScreen.tsx';
import { CreateProductForm, ReceiveStockForm } from './Management.tsx';
import { ProductPhoto } from './ProductPhoto.tsx';
import { M2CatalogEditor, M2StockAdjustment } from './M2Admin.tsx';

const brl = (cents:number) => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
const sizesFor = (p:Product,color:string) => [...new Set(p.variants.filter(v=>v.color===color).map(v=>v.size))];
function Garment({kind}:{kind:Product['kind']}) {
  return <svg viewBox="0 0 120 120" role="img" aria-label="Imagem ilustrativa; fotografia não cadastrada">
    {kind==='pants'?<path d="M37 15h46l-7 93H62L60 60l-3 48H43z" fill="currentColor"/>:
    kind==='bag'?<><rect x="24" y="50" width="72" height="55" rx="8" fill="currentColor"/><path d="M42 50Q42 12 60 12T78 50" fill="none" stroke="currentColor" strokeWidth="8"/></>:
    kind==='shoe'?<path d="M8 70Q30 60 40 35h23Q70 66 106 72l5 24H8z" fill="currentColor"/>:
    <path d="M37 13L10 37l14 24 13-10v57h46V51l13 10 14-24-27-24-12-4Q60 27 49 9z" fill="currentColor"/>}
  </svg>;
}
type Page = 'pdv'|'produtos'|'estoque';
export function App() {
  const [session,setSession] = useState<Session|null>(null);
  const [page,setPage] = useState<Page>('pdv');
  const [products,setProducts] = useState<Product[]>([]);
  const [allProducts,setAllProducts] = useState<Product[]>([]);
  const [cursor,setCursor] = useState<string|null>(null);
  const [paging,setPaging] = useState(false);
  const [stockSearch,setStockSearch] = useState('');
  const [search,setSearch] = useState('');
  const [debouncedSearch,setDebouncedSearch] = useState('');
  const [category,setCategory] = useState('Todos');
  const [selected,setSelected] = useState<Record<string,{color:string;size:string}>>({});
  const [draft,setDraft] = useState<DraftLine[]>([]);
  const [message,setMessage] = useState('');
  const [catalogError,setCatalogError] = useState('');
  const [loading,setLoading] = useState(false);
  const [refetch,setRefetch] = useState(0);
  const [cartOpen,setCartOpen] = useState(false);
  const [scanBusy,setScanBusy] = useState(false);
  const [stockLoading,setStockLoading] = useState(false);
  const manager = session?.roles.includes('manager')??false;
  const canReceive = manager || (session?.roles.includes('stocker')??false);
  const categories = useMemo(()=>['Todos',...new Set(products.map(p=>p.category))],[products]);
  const filtered = useMemo(()=>products.filter(p=>category==='Todos'||p.category===category),[products,category]);
  const total = draftTotalCents(draft);
  const quantity = draft.reduce((sum,line)=>sum+line.quantity,0);

  useEffect(()=>{
    const timer=setTimeout(()=>setDebouncedSearch(search),250);
    return ()=>clearTimeout(timer);
  },[search]);
  useEffect(()=>{
    if(!session){setProducts([]);setCursor(null);return;}
    const controller=new AbortController();
    setLoading(true);setCatalogError('');
    void listCatalog(session,debouncedSearch,fetch,controller.signal)
      .then(data=>{if(!controller.signal.aborted){setProducts(mapCatalog(data));setCursor(data.next_cursor);}})
      .catch(error=>{
        if(controller.signal.aborted)return;
        setProducts([]);setCursor(null);
        setCatalogError(error instanceof Error?error.message:'Não foi possível carregar o catálogo');
        if(error instanceof ApiError&&error.status===401){setSession(null);setDraft([]);}
      })
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[session,debouncedSearch,refetch]);
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
      const data=await listCatalog(session,debouncedSearch,fetch,undefined,cursor);
      const appended=mapCatalog(data);
      setProducts(current=>{
        const ids=new Set(current.map(p=>p.id));
        return [...current,...appended.filter(p=>!ids.has(p.id))];
      });
      setCursor(data.next_cursor);
    }catch(error){setCatalogError(error instanceof Error?error.message:'Erro ao buscar próxima página');}
    finally{setPaging(false);}
  }
  function authenticated(value:Session){
    setSession(value);setDraft([]);setPage('pdv');setSearch('');setSelected({});setCategory('Todos');setCatalogError('');setMessage('');
  }
  function logout(){
    const active=session;
    setSession(null);setDraft([]);setSelected({});setProducts([]);setAllProducts([]);setSearch('');setPage('pdv');
    if(active)void revokeSession(active).catch(()=>{/* logout local é imediato; sessão remota expira conforme servidor */});
  }
  function selectVariant(product:Product,color:string,size:string){
    const sizes=sizesFor(product,color);
    setSelected(current=>({...current,[product.id]:{color,size:sizes.includes(size)?size:(sizes[0]??'')}}));
  }
  function addVariant(variant:Variant){
    try { setDraft(addToDraft(draft,variant));setMessage(''); }
    catch(error){setMessage(error instanceof Error?error.message:'Não foi possível adicionar');}
  }
  async function scan(){
    if(!session||!search.trim()||scanBusy)return;
    setScanBusy(true);setMessage('');
    try{
      const page=mapCatalog(await listCatalog(session,search.trim()));
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

  const cart = <div className="cart-content">
    <div className="cart-head"><h2>Carrinho</h2><button className="text-btn" disabled={!draft.length} onClick={()=>setDraft([])}>Limpar</button></div>
    <p className="muted">{quantity} {quantity===1?'peça adicionada':'peças adicionadas'}</p>
    <div className="cart-lines">{draft.length?draft.map(line=><div className="cart-line" key={line.variant.id}>
      <div className="mini-visual" aria-hidden="true">◇</div><div className="cart-description"><strong>{products.find(p=>p.variants.some(v=>v.id===line.variant.id))?.name??line.variant.sku}</strong>
      <span>{line.variant.color} · {line.variant.size} · {line.variant.sku}</span>
      <div className="qty"><button aria-label={'Diminuir '+line.variant.sku} onClick={()=>setDraft(draft.flatMap(x=>x.variant.id!==line.variant.id?[x]:x.quantity===1?[]:[{...x,quantity:x.quantity-1}]))}>−</button>
      <span>{line.quantity}</span><button aria-label={'Aumentar '+line.variant.sku} onClick={()=>addVariant(line.variant)}>+</button></div>
      </div><strong>{brl(line.quantity*line.variant.priceCents)}</strong>
    </div>):<p className="empty-cart">Seu carrinho ainda está vazio. Escolha produtos do catálogo.</p>}</div>
    <div className="cart-footer"><div className="total-row"><span>Subtotal estimado</span><strong>{brl(total)}</strong></div>
    <p className="muted small">Rascunho local, sem reserva de estoque. Preço e disponibilidade precisam ser confirmados no servidor.</p>
    <button className="checkout-button" disabled title="Transação de venda será implementada no M3">Pagamento disponível após integração do caixa (M3)</button></div>
  </div>;

  return <div className="shell">
    <nav className="icon-rail" aria-label="Navegação principal">
      <div className="logo">L</div>
      <button className={page==='pdv'?'active':''} onClick={()=>setCurrentPage('pdv')} aria-label="PDV" title="PDV">▦</button>
      {manager&&<button className={page==='produtos'?'active':''} onClick={()=>setCurrentPage('produtos')} aria-label="Cadastrar produtos" title="Produtos">▤</button>}
      {canReceive&&<button className={page==='estoque'?'active':''} onClick={()=>setCurrentPage('estoque')} aria-label="Entrada de estoque" title="Estoque">▧</button>}
      <button className="exit" title="Sair" aria-label="Encerrar sessão" onClick={logout}>⇥</button>
    </nav>
    <main className="workspace">
      <header className="topbar">
        <div><h1>{page==='pdv'?'Nova venda':page==='produtos'?'Produtos':'Estoque'}</h1>
          <span>Loja {session.storeId.slice(0,8)} · {session.roles.join(', ')}</span></div>
        <div className="header-actions">
          <span className={catalogError?'demo-status disconnected':'demo-status'}>{catalogError?'Servidor indisponível':'Catálogo conectado à API'}</span>
          <button className="mobile-logout" onClick={logout}>Sair</button>
        </div>
      </header>
      {page==='pdv'&&<div className="work-area"><section className="products-area">
        <div className="heading"><h2>Selecionar produtos</h2><p>Dados reais por loja. Busca por nome, SKU ou código de barras.</p></div>
        <div className="search-row"><label htmlFor="search" className="sr-only">Buscar nome, SKU ou código</label>
          <input id="search" value={search} autoComplete="off" onChange={e=>setSearch(e.target.value)} onKeyDown={keySearch} placeholder="Pesquisar produto, SKU ou código…"/>
          <button type="button" className="scan-button" disabled={scanBusy||!search.trim()} onClick={()=>void scan()}>{scanBusy?'Consultando…':'Confirmar código'}</button>
        </div>
        <div className="categories" role="group" aria-label="Categorias disponíveis">
          {categories.map(c=><button key={c} className={category===c?'chosen':''} aria-pressed={category===c} onClick={()=>setCategory(c)}>{c}</button>)}
        </div>
        {message&&<p role="alert" className="error">{message}</p>}
        {catalogError&&<div className="error" role="alert">{catalogError} <button onClick={refreshed}>Tentar novamente</button></div>}
        {loading&&<p className="notice" role="status">Carregando produtos da loja…</p>}
        {!loading&&!catalogError&&<div className="product-grid">
          {filtered.map(p=>{
            const colors=[...new Set(p.variants.map(v=>v.color))];
            const choice=selected[p.id],color=choice?.color??colors[0]??'';
            const sizes=sizesFor(p,color),size=choice?.size&&sizes.includes(choice.size)?choice.size:sizes[0]??'';
            const selectedVariant=resolveVariant(p.variants,color,size);
            const ready=Boolean(choice)||p.variants.length===1;
            return <article key={p.id} className="product-card">
              <div className={'product-visual '+p.kind}>{p.hasPhoto?<ProductPhoto session={session} product={p}/>:<Garment kind={p.kind}/>}</div>
              <div className="card-copy">
                <h3 title={p.name}>{p.name}</h3>
                <p className="price">{selectedVariant?brl(selectedVariant.priceCents):'Indisponível'}</p>
                <div className="sizes" role="group" aria-label={'Tamanhos de '+p.name}>
                  {sizes.map(s=><button key={s} type="button" aria-pressed={ready&&size===s} className={ready&&size===s?'selected':''} onClick={()=>selectVariant(p,color,s)}>{s}</button>)}
                </div>
                <div className="card-bottom">
                  <div className="swatches" role="group" aria-label={'Cores de '+p.name}>
                    {colors.map(c=><button type="button" key={c} aria-label={'Selecionar cor '+c} aria-pressed={ready&&color===c}
                      title={c} className={ready&&color===c?'selected':''} onClick={()=>selectVariant(p,c,size)}>
                      <span className={'swatch '+(c==='Azul'?'azul':c==='Preto'?'preto':c==='Areia'?'areia':c==='Bege'?'bege':'cinza')}/></button>)}
                  </div>
                  <button className="add" aria-label={'Adicionar '+p.name} disabled={!ready||!selectedVariant||selectedVariant.available===0}
                    onClick={()=>{if(selectedVariant)addVariant(selectedVariant);}}>+</button>
                </div>
                <p className="stock-hint">{!ready?'Selecione cor e tamanho':selectedVariant?.available?selectedVariant.available+' disponíveis':'Sem estoque para esta variante'}</p>
              </div>
            </article>;
          })}
          {!filtered.length&&<p className="empty-catalog">Nenhuma peça disponível para estes filtros. Cadastre produtos ou altere a busca.</p>}
        </div>}
        {cursor&&<button className="light-button" disabled={paging} onClick={()=>void loadMore()}>{paging?'Carregando…':'Carregar mais produtos'}</button>}
        <p className="muted small">Catálogo real e fotografias privadas no servidor local. Atualize a busca para localizar SKU de outras páginas.</p>
      </section><aside className="cart-panel" aria-label="Carrinho da venda">{cart}</aside></div>}
      {page==='produtos'&&manager&&<><CreateProductForm session={session} onSaved={refreshed}/><M2CatalogEditor session={session} onSaved={refreshed}/></>}
      {page==='estoque'&&canReceive&&<>
        <div className="management-form">
          <label>Localizar peça para recebimento (nome ou SKU)
            <input value={stockSearch} onChange={e=>setStockSearch(e.target.value)} placeholder="Buscar no servidor"/>
          </label>
          {stockLoading&&<p className="notice">Carregando variantes para recebimento…</p>}
          <p className="muted small">Mostrando até 50 resultados; pesquise o SKU exato para outros itens.</p>
        </div>
        <ReceiveStockForm session={session} products={allProducts} onSaved={refreshed}/>
        {manager&&<M2StockAdjustment session={session} onSaved={refreshed}/>}
      </>}
    </main>
    {page==='pdv'&&<button className="mobile-cart" onClick={()=>setCartOpen(true)}>Ver carrinho · {quantity} peças · {brl(total)}</button>}
    {page==='pdv'&&cartOpen&&<div className="drawer-backdrop" onMouseDown={()=>setCartOpen(false)}>
      <aside className="mobile-drawer" role="dialog" aria-modal="true" aria-label="Carrinho" onMouseDown={e=>e.stopPropagation()}>
        <button className="close-drawer" onClick={()=>setCartOpen(false)}>Fechar ×</button>{cart}
      </aside></div>}
  </div>;
}
