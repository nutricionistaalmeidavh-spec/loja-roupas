import { useEffect, useState } from 'react';
import type { Session } from './api-client.ts';
import { listCatalog } from './api-client.ts';
import { mapCatalog } from './catalog-model.ts';
import type { Product } from './catalog-model.ts';
import { CreateProductForm } from './Management.tsx';
import { M2CatalogEditor } from './M2Admin.tsx';
import { TaskDialog } from './TaskDialog.tsx';
import { ProductSpreadsheetImport } from './ProductSpreadsheetImport.tsx';

export function ProductsWorkspace({session,onSaved}:{session:Session;onSaved:()=>void}){
  const [search,setSearch]=useState('');
  const [products,setProducts]=useState<Product[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [mode,setMode]=useState<'list'|'edit'>('list');
  const [createOpen,setCreateOpen]=useState(false);
  const [importOpen,setImportOpen]=useState(false);
  const [revision,setRevision]=useState(0);
  function refreshed(){setRevision(x=>x+1);onSaved();}
  useEffect(()=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>{
      setLoading(true);setError('');
      void listCatalog(session,search,fetch,controller.signal).then(page=>{
        if(!controller.signal.aborted)setProducts(mapCatalog(page));
      }).catch(err=>{
        if(!controller.signal.aborted)setError(err instanceof Error?err.message:'Não foi possível consultar o catálogo');
      }).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    },250);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[session,search,revision]);
  return <div className="products-workspace">
    <section className="workspace-hero">
      <div><h2>Catálogo da loja</h2>
        <p>Consulte e organize as peças. Cadastros, edições e importações aparecem apenas quando necessários.</p>
      </div>
      <div className="workspace-actions">
        <button type="button" className="primary-action" onClick={()=>setCreateOpen(true)}>+ Novo produto</button>
        <button type="button" className="light-button" onClick={()=>setImportOpen(true)}>Importar planilha</button>
        <button type="button" className="light-button" onClick={()=>setMode(x=>x==='edit'?'list':'edit')}>
          {mode==='edit'?'Voltar ao catálogo':'Editar produto'}
        </button>
      </div>
    </section>
    {mode==='list'?<section className="workspace-card">
      <label className="workspace-search-label">Pesquisar no catálogo
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Nome, SKU ou código de barras"/>
      </label>
      {loading&&<p role="status">Buscando produtos…</p>}
      {error&&<p className="error" role="alert">{error}</p>}
      {!loading&&!products.length&&!error&&<p className="muted">
        Nenhum produto encontrado. Use Novo produto ou Importar planilha para começar.
      </p>}
      <div className="catalog-list" role="list" aria-label="Produtos cadastrados">
        {products.map(product=><article role="listitem" className="catalog-list-item" key={product.id}>
          <div className="catalog-list-identity">
            <strong>{product.name}</strong>
            <span>{product.category} · {product.variants.length} variações</span>
          </div>
          <div className="catalog-list-meta">
            <span>{product.variants.reduce((n,v)=>n+v.available,0)} em estoque</span>
            <button className="light-button" onClick={()=>setMode('edit')}>Editar</button>
          </div>
        </article>)}
      </div>
      {products.length===50&&<p className="muted small">Exibindo até 50 peças. Refine a busca para encontrar outros produtos.</p>}
    </section>:<div className="workspace-editor">
      <M2CatalogEditor session={session} onSaved={refreshed}/>
    </div>}
    {createOpen&&<TaskDialog title="Novo produto" wide onClose={()=>setCreateOpen(false)}>
      <CreateProductForm session={session} onSaved={refreshed}/>
    </TaskDialog>}
    {importOpen&&<ProductSpreadsheetImport session={session} onSaved={refreshed}
      onClose={()=>setImportOpen(false)}/>}
  </div>;
}
