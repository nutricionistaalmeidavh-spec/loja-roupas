import {useState} from 'react';
import type {Session} from './api-client.ts';
import type {Product} from './catalog-model.ts';
import {AppDialog} from './AppDialog.tsx';
import {CreateProductForm,ReceiveStockForm} from './Management.tsx';
import {M2CatalogEditor,M2StockAdjustment} from './M2Admin.tsx';
import {ProductImport} from './ProductImport.tsx';

type ProductAction='create'|'edit'|'import'|null;
export function ProductWorkspace({session,onSaved}:{session:Session;onSaved:()=>void}){
 const [action,setAction]=useState<ProductAction>(null);
 const [notice,setNotice]=useState('');
 function saved(){onSaved();setNotice('Produto cadastrado com sucesso.');if(action==='create')setAction(null);}
 return <section className="workspace-hub" aria-label="Gerenciar produtos">
  <div className="hub-heading">
   <div><h2>Catálogo de roupas</h2><p>Cadastre peças, organize variantes e mantenha preços e fotografias atualizados.</p></div>
   <div className="hub-actions">
    <button type="button" className="primary-action" onClick={()=>setAction('create')}>Novo produto</button>
    <button type="button" className="light-button" onClick={()=>setAction('import')}>Importar planilha</button>
   </div>
  </div>
  {notice&&<p role="status" className="notice">{notice}</p>}
  <div className="hub-grid">
   <button className="hub-tile" type="button" onClick={()=>setAction('create')}>
    <span className="hub-icon" aria-hidden="true">+</span><strong>Cadastrar peça</strong><span>Nome, categoria, cores e tamanhos</span>
   </button>
   <button className="hub-tile" type="button" onClick={()=>setAction('edit')}>
    <span className="hub-icon" aria-hidden="true">✎</span><strong>Editar catálogo</strong><span>Preços, fotos, códigos e variantes</span>
   </button>
   <button className="hub-tile" type="button" onClick={()=>setAction('import')}>
    <span className="hub-icon" aria-hidden="true">⇧</span><strong>Importar em lote</strong><span>Baixar modelo CSV, revisar e enviar</span>
   </button>
  </div>
  {action==='edit'&&<div className="hub-editor">
   <div className="hub-heading"><h3>Editar catálogo</h3><button className="light-button" type="button" onClick={()=>setAction(null)}>Voltar ao início</button></div>
   <M2CatalogEditor session={session} onSaved={onSaved}/>
  </div>}
  {action==='create'&&<AppDialog title="Cadastrar produto" wide onClose={()=>setAction(null)}>
   <CreateProductForm session={session} onSaved={saved}/>
  </AppDialog>}
  {action==='import'&&<AppDialog title="Importar produtos por planilha" wide onClose={()=>setAction(null)}>
   <ProductImport session={session} onSaved={()=>{onSaved();setNotice('Importação de produtos concluída.');}}/>
  </AppDialog>}
 </section>;
}
type StockAction='receive'|'adjust'|null;
export function StockWorkspace({session,products,manager,onSaved,query,onSearch,loading,refreshKey}:{
 session:Session;products:Product[];manager:boolean;onSaved:()=>void;
 query:string;onSearch:(value:string)=>void;loading:boolean;refreshKey:number;
}){
 const [action,setAction]=useState<StockAction>(null);
 const variants=products.flatMap(product=>product.variants.map(variant=>({
  key:variant.id,name:product.name,sku:variant.sku,color:variant.color,size:variant.size,available:variant.available
 })));
 return <section className="workspace-hub">
  <div className="hub-heading">
   <div><h2>Estoque de peças</h2><p>Consulte saldos por SKU, receba mercadorias e corrija divergências com histórico.</p></div>
   <div className="hub-actions">
    <button className="primary-action" type="button" onClick={()=>setAction('receive')}>Registrar entrada</button>
    {manager&&<button className="light-button" type="button" onClick={()=>setAction('adjust')}>Ajustar saldo</button>}
   </div>
  </div>
  <div className="stock-overview">
   <label>Localizar peça para recebimento (nome ou SKU)
    <input value={query} onChange={event=>onSearch(event.target.value)} placeholder="Pesquisar no catálogo da loja"/>
   </label>
   {loading?<p role="status">Consultando estoque…</p>:<div className="management-table-scroll" role="region" tabIndex={0} aria-label="Saldo das variantes">
    <table><thead><tr><th>Peça</th><th>SKU</th><th>Cor / tamanho</th><th>Disponível</th></tr></thead>
    <tbody>{variants.map(item=><tr key={item.key}><td>{item.name}</td><td>{item.sku}</td>
     <td>{item.color} / {item.size}</td><td>{item.available}</td></tr>)}</tbody></table>
    {!variants.length&&<p className="muted">Nenhuma peça encontrada. Ajuste a busca ou cadastre um produto.</p>}
   </div>}
   <p className="muted small">Até 50 produtos por consulta. Pesquise um SKU para localizar peças de outras páginas.</p>
  </div>
  {action==='receive'&&<AppDialog title="Entrada de estoque" wide onClose={()=>setAction(null)}>
   <ReceiveStockForm session={session} products={products} onSaved={onSaved}/>
  </AppDialog>}
  {action==='adjust'&&manager&&<AppDialog title="Ajustar saldo de estoque" wide onClose={()=>setAction(null)}>
   <M2StockAdjustment session={session} onSaved={onSaved} refreshKey={refreshKey}/>
  </AppDialog>}
 </section>;
}
