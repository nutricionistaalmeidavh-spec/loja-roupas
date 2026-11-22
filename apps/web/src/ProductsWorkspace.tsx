import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { Session } from './api-client.ts';
import { listCatalog } from './api-client.ts';
import { mapCatalog } from './catalog-model.ts';
import type { Product } from './catalog-model.ts';
import { CreateProductForm } from './Management.tsx';
import { M2CatalogEditor } from './M2Admin.tsx';
import { TaskDialog } from './TaskDialog.tsx';
import { UiIcon } from './UiIcon.tsx';
import {RetailEmpty} from './RetailUI.tsx';
import { ProductSpreadsheetImport } from './ProductSpreadsheetImport.tsx';

const InventorySpreadsheet=lazy(()=>import('./InventorySpreadsheet.tsx'));

export function ProductsWorkspace({session,onSaved}:{session:Session;onSaved:()=>void}){
  const [search,setSearch]=useState('');
  const [products,setProducts]=useState<Product[]>([]);
  const [loading,setLoading]=useState(false);
  const [loadingMore,setLoadingMore]=useState(false);
  const [nextCursor,setNextCursor]=useState<string|null>(null);
  const generation=useRef(0);
  const moreController=useRef<AbortController|null>(null);
  const [error,setError]=useState('');
  const [mode,setMode]=useState<'list'|'edit'|'sheet'>('list');
  const [selectedProduct,setSelectedProduct]=useState<{id:string;name:string}|null>(null);
  const [createOpen,setCreateOpen]=useState(false);
  const [createLocked,setCreateLocked]=useState(false);
  const [importOpen,setImportOpen]=useState(false);
  const [revision,setRevision]=useState(0);
  function refreshed(){setRevision(x=>x+1);onSaved();}
  useEffect(()=>{
    const controller=new AbortController();
    const current=++generation.current;
    moreController.current?.abort();
    setLoadingMore(false);
    setProducts([]);
    setNextCursor(null);
    setError('');
    setLoading(true);
    const timer=setTimeout(()=>{
      void listCatalog(session,search,fetch,controller.signal).then(page=>{
        if(!controller.signal.aborted&&generation.current===current){
          setProducts(mapCatalog(page));
          setNextCursor(page.next_cursor);
        }
      }).catch(err=>{
        if(!controller.signal.aborted&&generation.current===current)
          setError(err instanceof Error?err.message:'Não foi possível consultar o catálogo');
      }).finally(()=>{
        if(!controller.signal.aborted&&generation.current===current)setLoading(false);
      });
    },250);
    return ()=>{clearTimeout(timer);controller.abort();moreController.current?.abort();};
  },[session,search,revision]);
  async function loadMore(){
    if(!nextCursor||loading||loadingMore)return;
    const controller=new AbortController();
    moreController.current?.abort();
    moreController.current=controller;
    const current=generation.current;
    setLoadingMore(true);setError('');
    try{
      const page=await listCatalog(session,search,fetch,controller.signal,nextCursor);
      if(controller.signal.aborted||generation.current!==current)return;
      const incoming=mapCatalog(page);
      setProducts(previous=>{
        const merged=new Map(previous.map(p=>[p.id,p]));
        for(const product of incoming)merged.set(product.id,product);
        return [...merged.values()];
      });
      setNextCursor(page.next_cursor);
    }catch(err){
      if(!controller.signal.aborted&&generation.current===current)
        setError(err instanceof Error?err.message:'Não foi possível carregar mais produtos');
    }finally{
      if(!controller.signal.aborted&&generation.current===current)setLoadingMore(false);
    }
  }
  return <div className="products-workspace">
    <section className="workspace-hero">
      <div><h2>Catálogo da loja</h2>
        <p>Consulte e organize as peças. Cadastros, edições e importações aparecem apenas quando necessários.</p>
      </div>
      <div className="workspace-actions">
        <button type="button" className="primary-action" onClick={()=>setCreateOpen(true)}>+ Novo produto</button>
        <button type="button" className="light-button" onClick={()=>setMode('sheet')}>Planilha editável</button>
        <button type="button" className="light-button" onClick={()=>setImportOpen(true)}>Importar planilha</button>
        <button type="button" className="light-button" onClick={()=>{setSelectedProduct(null);setMode(x=>x==='edit'?'list':'edit');}}>
          {mode==='edit'?'Voltar ao catálogo':'Editar produto'}
        </button>
      </div>
    </section>
    {mode==='sheet'?<Suspense fallback={<p role="status">Abrindo planilha de produtos…</p>}>
      <InventorySpreadsheet session={session} onSaved={refreshed} canEdit canReceive/>
    </Suspense>:mode==='list'?<section className="workspace-card">
      <label className="workspace-search-label">Pesquisar no catálogo
        <span className="workspace-search-field">
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Nome, SKU ou código de barras"/>
          {search&&<button type="button" aria-label="Limpar busca de produtos" onClick={()=>setSearch('')}><UiIcon name="x" size={16}/></button>}
        </span>
      </label>
      {loading&&<p role="status">Buscando produtos…</p>}
      {error&&<p className="error" role="alert">{error}</p>}
      {!loading&&!products.length&&!error&&<RetailEmpty
        title={search?'Nenhum produto encontrado':'O catálogo está vazio'}
        description={search?'Altere os termos da busca para encontrar outras peças.':'Use Novo produto ou Importar planilha para começar.'}/>}
      {error&&<button className="light-button" type="button" onClick={()=>setRevision(x=>x+1)}>Tentar novamente</button>}
      <div className="catalog-list" role="list" aria-label="Produtos cadastrados">
        {products.map(product=><article role="listitem" className="catalog-list-item" key={product.id}>
          <div className="catalog-list-identity">
            <strong>{product.name}</strong>
            <span>{product.category} · {product.variants.length} variações</span>
          </div>
          <div className="catalog-list-meta">
            <span>{product.variants.reduce((n,v)=>n+v.available,0)} em estoque</span>
            <button className="light-button" onClick={()=>{setSelectedProduct({id:product.id,name:product.name});setMode('edit');}}>Editar</button>
          </div>
        </article>)}
      </div>
      {nextCursor&&<button type="button" className="light-button" disabled={loading||loadingMore} onClick={()=>void loadMore()}>{loadingMore?'Carregando…':'Carregar mais produtos'}</button>}
      {!loading&&products.length>0&&<p className="muted small">{products.length} produto(s) exibido(s){nextCursor?' · há mais resultados':''}.</p>}
    </section>:<div className="workspace-editor">
      <M2CatalogEditor key={selectedProduct?.id??'catalog-editor'} session={session} onSaved={refreshed}
        initialProductId={selectedProduct?.id} initialProductName={selectedProduct?.name}/>
    </div>}
    {createOpen&&<TaskDialog title="Novo produto" wide busy={createLocked} onClose={()=>setCreateOpen(false)}>
      <CreateProductForm session={session} onSaved={refreshed} onLockChange={setCreateLocked}/>
    </TaskDialog>}
    {importOpen&&<ProductSpreadsheetImport session={session} onSaved={refreshed}
      onClose={()=>setImportOpen(false)}/>}
  </div>;
}
