import { useMemo, useState } from 'react';
import { addToDraft, draftTotalCents, resolveVariant } from '@loja/domain';
import type { DraftLine } from '@loja/domain';
import { products } from './demo.ts';
import type { Product } from './demo.ts';

const brl = (cents: number) => new Intl.NumberFormat('pt-BR',{ style:'currency', currency:'BRL' }).format(cents/100);
const getSizes = (item: Product, color: string) => [...new Set(item.variants.filter(v=>v.color===color).map(v=>v.size))];

function Garment({ kind }: {kind: Product['kind']}) {
  return <svg viewBox="0 0 120 120" role="img" aria-label="Ilustração de produto sem fotografia">
    {kind==='pants' ? <path d="M37 15h46l-7 93H62L60 60l-3 48H43z" fill="currentColor"/> :
    kind==='bag' ? <><rect x="24" y="50" width="72" height="55" rx="8" fill="currentColor"/><path d="M42 50Q42 12 60 12T78 50" fill="none" stroke="currentColor" strokeWidth="8"/></> :
    kind==='shoe' ? <path d="M8 70Q30 60 40 35h23Q70 66 106 72l5 24H8z" fill="currentColor"/> :
    <path d="M37 13L10 37l14 24 13-10v57h46V51l13 10 14-24-27-24-12-4Q60 27 49 9z" fill="currentColor"/>}
  </svg>;
}

export function App() {
  const [category,setCategory] = useState('Todos');
  const [search,setSearch] = useState('');
  const [selected,setSelected] = useState<Record<string,{color:string;size:string}>>({});
  const [draft,setDraft] = useState<DraftLine[]>([]);
  const [message,setMessage] = useState('');
  const [cartOpen,setCartOpen] = useState(false);
  const filtered = useMemo(()=>products.filter(p=>(category==='Todos'||p.category===category) &&
    (p.name+' '+p.variants.map(v=>v.sku).join(' ')).toLowerCase().includes(search.trim().toLowerCase())),[category,search]);
  const total = draftTotalCents(draft);
  const quantity = draft.reduce((n,v)=>n+v.quantity,0);

  function updateSelection(product:Product,color:string,size:string) {
    const sizes=getSizes(product,color);
    setSelected(old=>({...old,[product.id]:{color,size:sizes.includes(size)?size:(sizes[0]??'')}}));
  }
  function addProduct(product:Product) {
    const choice=selected[product.id];
    if(!choice){setMessage('Selecione cor e tamanho para adicionar.'); return;}
    const variant=resolveVariant(product.variants,choice.color,choice.size);
    if(!variant){setMessage('Combinação não cadastrada.');return;}
    try {setDraft(lines=>addToDraft(lines,variant)); setMessage('');}
    catch(error){setMessage(error instanceof Error?error.message:'Não foi possível adicionar');}
  }
  const cart = <div className="cart-content">
    <div className="cart-head"><h2>Carrinho</h2><button className="text-btn" onClick={()=>setDraft([])} disabled={!draft.length}>Limpar</button></div>
    <p className="muted">{quantity} {quantity===1?'peça selecionada':'peças selecionadas'}</p>
    <div className="cart-lines">{draft.length?draft.map(line=><div className="cart-line" key={line.variant.id}>
      <div className="mini-visual">◆</div><div className="cart-description"><strong>{products.find(p=>p.variants.some(v=>v.id===line.variant.id))?.name}</strong>
      <span>{line.variant.color} · {line.variant.size}</span><div className="qty">
      <button aria-label={'Diminuir '+line.variant.sku} onClick={()=>setDraft(d=>d.flatMap(x=>x.variant.id!==line.variant.id?[x]:x.quantity===1?[]:[{...x,quantity:x.quantity-1}]))}>−</button>
      <span>{line.quantity}</span><button aria-label={'Aumentar '+line.variant.sku} onClick={()=>{try{setDraft(d=>addToDraft(d,line.variant));setMessage('');}catch(err){setMessage(err instanceof Error?err.message:'Limite atingido');}}}>+</button></div></div>
      <strong>{brl(line.quantity*line.variant.priceCents)}</strong></div>):
      <p className="empty-cart">Selecione uma peça para começar a montagem do carrinho.</p>}</div>
    <div className="cart-footer"><div className="total-row"><span>Subtotal estimado</span><strong>{brl(total)}</strong></div>
    <p className="muted small">Valores ilustrativos. A confirmação depende da API, estoque e caixa.</p>
    <button className="checkout-button" disabled>Pagamento disponível após integração do PDV</button></div>
  </div>;
  return <div className="shell">
    <nav className="icon-rail" aria-label="Menu principal"><div className="logo">L</div><button className="active" aria-label="PDV">▦</button><button title="Produtos (futuro)" disabled>▤</button><button title="Estoque (futuro)" disabled>▧</button><button title="Configurações (futuro)" disabled>⚙</button></nav>
    <main className="workspace">
      <header className="topbar"><div><h1>Nova venda</h1><span>Loja de Roupas · Demonstração visual</span></div><span className="demo-status">Somente interface · Sem venda real</span></header>
      <div className="work-area"><section className="products-area"><div className="heading"><h2>Selecionar produtos</h2><p>Encontre por nome, SKU ou categoria</p></div>
      <div className="search-row"><label className="sr-only" htmlFor="search">Buscar produtos ou SKU</label><input id="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Pesquisar produto, SKU ou código..." autoComplete="off"/><button className="scan-button" disabled title="Scanner será integrado após API">Escanear código</button></div>
      <div className="categories" role="group" aria-label="Categorias">{['Todos','Feminino','Masculino','Acessórios'].map(c=><button key={c} className={category===c?'chosen':''} aria-pressed={category===c} onClick={()=>setCategory(c)}>{c}</button>)}</div>
      {message && <p className="error" role="alert">{message}</p>}
      <div className="product-grid">{filtered.map(product=>{
        const colors=[...new Set(product.variants.map(v=>v.color))];const choice=selected[product.id];const color=choice?.color??colors[0]; const sizes=getSizes(product,color);
        const size=choice?.size??sizes[0]; const varSelected=resolveVariant(product.variants,color,size);
        const chosen=Boolean(choice);
        return <article className="product-card" key={product.id}>
          <div className={'product-visual '+product.kind}><Garment kind={product.kind}/></div><div className="card-copy"><h3>{product.name}</h3><p className="price">{brl(varSelected?.priceCents??product.variants[0].priceCents)}</p>
          <div className="sizes" aria-label={'Tamanhos de '+product.name}>{sizes.map(s=><button key={s} className={chosen&&size===s?'selected':''} aria-pressed={chosen&&size===s} onClick={()=>updateSelection(product,color,s)}>{s}</button>)}</div>
          <div className="card-bottom"><div className="swatches" aria-label={'Cores de '+product.name}>{colors.map(c=><button key={c} className={(chosen&&color===c)?'selected':''} onClick={()=>updateSelection(product,c,size)} aria-label={'Cor '+c} aria-pressed={chosen&&color===c} title={c}><span className={'swatch '+(c==='Azul'?'azul':c==='Preto'?'preto':c==='Areia'?'areia':c==='Bege'?'bege':'cinza')}/></button>)}</div>
          <button className="add" aria-label={'Adicionar '+product.name} onClick={()=>addProduct(product)} disabled={Boolean(chosen && !varSelected?.available)}>+</button></div>
          {chosen&&!varSelected?.available&&<p className="soldout">Variante indisponível</p>}</div></article>;
      })}</div>{!filtered.length&&<p>Nenhum produto encontrado.</p>}</section>
      <aside className="cart-panel" aria-label="Carrinho da venda">{cart}</aside></div>
    </main><button className="mobile-cart" onClick={()=>setCartOpen(true)} aria-label="Abrir carrinho">{quantity} peças · {brl(total)} · Ver carrinho</button>
    {cartOpen&&<div className="drawer-backdrop" onMouseDown={()=>setCartOpen(false)}><aside className="mobile-drawer" role="dialog" aria-modal="true" aria-label="Carrinho" onMouseDown={e=>e.stopPropagation()}><button className="close-drawer" onClick={()=>setCartOpen(false)}>Fechar ×</button>{cart}</aside></div>}
  </div>;
}
