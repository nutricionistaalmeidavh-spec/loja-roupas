import 'react-data-grid/lib/styles.css';
import {DataGrid,renderTextEditor} from 'react-data-grid';
import type {Column,RowsChangeData} from 'react-data-grid';
import {useEffect,useMemo,useRef,useState} from 'react';
import {ApiError,listStockSpreadsheet,patchSpreadsheetRow,listCatalog} from './api-client.ts';
import type {Session,StockSpreadsheetRow} from './api-client.ts';
import {reaisToCents,mapCatalog} from './catalog-model.ts';
import type {Product} from './catalog-model.ts';
import {requestId} from './request-id.ts';
import {ReceiveStockForm} from './Management.tsx';
import {M2StockAdjustment} from './M2Admin.tsx';
import {TaskDialog} from './TaskDialog.tsx';
import {SpreadsheetBulkEditor} from './SpreadsheetBulkEditor.tsx';
import {StockMovementHistory} from './StockMovementHistory.tsx';
import {DirectReceiptPermissions} from './DirectReceiptPermissions.tsx';

const money=(c:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(c/100);
type SheetRow=Omit<StockSpreadsheetRow,'barcode'> & {barcode:string;price_edit:string};
type Action={kind:'receive'|'adjust'|'history';row:SheetRow};
function toRow(row:StockSpreadsheetRow):SheetRow{
 return {...row,barcode:row.barcode??'',price_edit:(row.price_cents/100).toFixed(2).replace('.',',')};
}
function safePrice(value:string){
 return reaisToCents(value.trim().replace('.',','));
}
function movementLabel(kind:string){
 return ({receipt:'Recebimento',sale:'Venda',return:'Devolução',adjustment:'Ajuste'} as Record<string,string>)[kind]??kind;
}
function movementSource(source:string){
 return ({
  manual_receipt:'Entrada manual',direct_receipt:'Entrada direta',direct_receipt_reversal:'Estorno de entrada direta',spreadsheet_import:'Importação de planilha',
  purchase:'Pedido de compra',sale:'Venda confirmada',
  sale_return:'Devolução de venda',manager_adjustment:'Conferência gerencial'
 } as Record<string,string>)[source]??source;
}

export default function InventorySpreadsheet({session,onSaved,canEdit,canReceive}:{
 session:Session;onSaved:()=>void;canEdit:boolean;canReceive:boolean;
}){
 const [query,setQuery]=useState('');
 const [search,setSearch]=useState('');
 const [category,setCategory]=useState('');
 const [categories,setCategories]=useState<string[]>([]);
 const [offset,setOffset]=useState(0);
 const [rows,setRows]=useState<SheetRow[]>([]);
 const [total,setTotal]=useState(0);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [refreshKey,setRefreshKey]=useState(0);
 const [lastUpdated,setLastUpdated]=useState('');
 const [stale,setStale]=useState(false);
 const [dirty,setDirty]=useState<string|null>(null);
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const dirtyRef=useRef<string|null>(null);
 const [saving,setSaving]=useState(false);
 const savingRef=useRef(false);
 const [pending,setPending]=useState<{id:string;body:string;key:string}|null>(null);
 const [action,setAction]=useState<Action|null>(null);
 const [actionProducts,setActionProducts]=useState<Product[]>([]);
 const [actionLoading,setActionLoading]=useState(false);
 const [bulkOpen,setBulkOpen]=useState(false);
 const [fullHistoryOpen,setFullHistoryOpen]=useState(false);
 const [permissionsOpen,setPermissionsOpen]=useState(false);
 const [exporting,setExporting]=useState(false);
 const [exportStatus,setExportStatus]=useState('');
 const [historyError,setHistoryError]=useState('');
 const limit=50;
 const selectedRow=rows.find(r=>r.variant_id===selectedId)??null;

 useEffect(()=>{
  const timer=setTimeout(()=>{setOffset(0);setSearch(query.trim());},270);
  return ()=>clearTimeout(timer);
 },[query]);
 useEffect(()=>{
  let active=true,serial=0;
  const ctrl=new AbortController();
  async function load(background:boolean){
   if(document.hidden||savingRef.current||dirtyRef.current){
    if(dirtyRef.current)setStale(true);
    return;
   }
   const current=++serial;
   if(!background)setLoading(true);
   try{
    const page=await listStockSpreadsheet(session,{query:search,category,offset,limit},fetch,ctrl.signal);
    if(!active||current!==serial)return;
    if(dirtyRef.current||savingRef.current){setStale(true);return;}
    setRows(page.items.map(toRow));setTotal(page.total);setCategories(page.categories);
    setError('');setStale(false);setLastUpdated(new Date().toLocaleTimeString('pt-BR'));
   }catch(err){
    if(active&&!ctrl.signal.aborted)setError(err instanceof Error?err.message:'Falha ao atualizar a planilha');
   }finally{
    if(active&&current===serial)setLoading(false);
   }
  }
  void load(false);
  const timer=window.setInterval(()=>void load(true),15000);
  const visible=()=>{if(!document.hidden)void load(true);};
  document.addEventListener('visibilitychange',visible);
  return ()=>{active=false;ctrl.abort();window.clearInterval(timer);
   document.removeEventListener('visibilitychange',visible);};
 },[session,search,category,offset,refreshKey]);

 useEffect(()=>{
  if(!action){setActionProducts([]);setHistoryError('');return;}
  if(action.kind==='receive'){
   const ctrl=new AbortController();
   setActionLoading(true);
   void listCatalog(session,action.row.sku,fetch,ctrl.signal).then(data=>{
    if(!ctrl.signal.aborted)setActionProducts(mapCatalog(data));
   }).catch(err=>{if(!ctrl.signal.aborted)setHistoryError(err instanceof Error?err.message:'Falha ao buscar SKU');})
    .finally(()=>{if(!ctrl.signal.aborted)setActionLoading(false);});
   return ()=>ctrl.abort();
  }
 },[action,session]);

 function editRows(next:SheetRow[],data:RowsChangeData<SheetRow>){
  if(!canEdit||savingRef.current||pending)return;
  const changed=next[data.indexes[0]];
  if(!changed)return;
  if(dirtyRef.current&&dirtyRef.current!==changed.variant_id){
   setNotice('Salve ou descarte a linha em edição antes de alterar outro SKU.');
   return;
  }
  setRows(next);dirtyRef.current=changed.variant_id;setDirty(changed.variant_id);
  setNotice('Alterações locais ainda não foram salvas no servidor.');
 }

 function discard(){
  dirtyRef.current=null;setDirty(null);setPending(null);setNotice('Edição descartada.');
  setRefreshKey(n=>n+1);
 }

 async function saveRow(row:SheetRow){
  if(!canEdit||savingRef.current||dirtyRef.current!==row.variant_id)return;
  setError('');setNotice('');
  let body:string;
  try{
   body=JSON.stringify({
    name:row.name,category:row.category,sku:row.sku,color:row.color,size:row.size,
    barcode:row.barcode.trim()||null,price_cents:safePrice(row.price_edit),
    expected_product_revision:row.product_revision,
    expected_variant_revision:row.variant_revision
   });
  }catch(err){setError(err instanceof Error?err.message:'Preço inválido');return;}
  if(pending&&(pending.id!==row.variant_id||pending.body!==body)){
   setError('Envio pendente: repita o salvamento sem modificar os campos.');
   return;
  }
  const key=pending?.key??requestId();
  setPending({id:row.variant_id,key,body});
  savingRef.current=true;setSaving(true);
  try{
   await patchSpreadsheetRow(session,row.variant_id,JSON.parse(body),key);
   setPending(null);dirtyRef.current=null;setDirty(null);
   setNotice('Alterações salvas e auditadas no servidor.');
   setRefreshKey(n=>n+1);onSaved();
  }catch(err){
   setError(err instanceof Error?err.message:'Falha ao salvar a linha');
   if(err instanceof ApiError&&err.status>=400&&err.status<500)setPending(null);
  }finally{savingRef.current=false;setSaving(false);}
 }

 function afterStockChange(){
  setRefreshKey(n=>n+1);onSaved();
  setNotice('Estoque atualizado. A planilha foi sincronizada.');
 }

 const columns=useMemo<readonly Column<SheetRow>[]>(()=>[
  {key:'sku',name:'SKU',width:154,frozen:true,renderEditCell:renderTextEditor,editable:canEdit},
  {key:'name',name:'Produto',width:200,renderEditCell:renderTextEditor,editable:canEdit},
  {key:'category',name:'Categoria',width:140,renderEditCell:renderTextEditor,editable:canEdit},
  {key:'color',name:'Cor',width:110,renderEditCell:renderTextEditor,editable:canEdit},
  {key:'size',name:'Tam.',width:85,renderEditCell:renderTextEditor,editable:canEdit},
  {key:'barcode',name:'Código de barras',width:170,renderEditCell:renderTextEditor,editable:canEdit},
  {key:'price_edit',name:'Preço R$',width:115,renderEditCell:renderTextEditor,editable:canEdit},
  {key:'on_hand',name:'Físico',width:86,renderCell:({row})=><strong>{row.on_hand}</strong>},
  {key:'reserved',name:'Reservado',width:96},
  {key:'available',name:'Disponível',width:110,renderCell:({row})=>
   <span className={row.available===0?'sheet-empty':row.available<=3?'sheet-low':''}>{row.available}</span>},
  {key:'entries',name:'Entradas',width:89},
  {key:'sold',name:'Vendas',width:84},
  {key:'returns',name:'Devoluções',width:106},
  {key:'adjustments',name:'Ajustes',width:86},
  {key:'actions',name:'Ações',width:300,renderCell:({row})=>
   <div className="sheet-row-actions">
    {dirty===row.variant_id?<>
     <button disabled={saving} onClick={()=>void saveRow(row)} aria-label={'Salvar alterações de '+row.sku}>Salvar</button>
     <button disabled={saving||Boolean(pending)} onClick={discard} aria-label={'Descartar alterações de '+row.sku}>Descartar</button>
    </>:<>
     {canReceive&&<button onClick={()=>setAction({kind:'receive',row})} aria-label={'Receber '+row.sku}>Receber</button>}
     {canEdit&&<button onClick={()=>setAction({kind:'adjust',row})} aria-label={'Ajustar '+row.sku}>Ajustar</button>}
     <button onClick={()=>setAction({kind:'history',row})} aria-label={'Histórico '+row.sku}>Histórico</button>
    </>}
   </div>}
 ],[canEdit,canReceive,dirty,pending,saving,session]);

 return <div className="stock-spreadsheet">
  <div className="sheet-toolbar">
   <div><h2>Planilha operacional</h2>
    <p>Dados reais por SKU. Edite o cadastro na célula; entradas e saídas são movimentos auditados.</p>
   </div>
   <div className="workspace-actions">
    <button type="button" className="light-button" disabled={saving}
      onClick={()=>{setError('');void import('./product-xlsx-file.ts')
        .then(m=>m.downloadStockXlsx(rows)).catch(err=>setError(err instanceof Error?err.message:'Falha na exportação'));}}>
      Exportar página XLSX
    </button>
    {canEdit&&<button type="button" className="light-button" disabled={Boolean(dirty)||saving||loading||rows.length===0}
      onClick={()=>setBulkOpen(true)}>Edição em lote / Colar Excel</button>}
    <button type="button" className="light-button" disabled={Boolean(dirty)||saving||exporting}
      onClick={()=>{
       setError('');setExportStatus('Consultando resultados filtrados…');setExporting(true);
       void import('./stock-filtered-export.ts')
        .then(m=>m.downloadFilteredStockXlsx(session,{query:search,category},(count,total)=>
         setExportStatus('Preparando '+count+' de '+total+' SKUs…')))
        .then(count=>setExportStatus(count+' SKUs filtrados exportados em XLSX.'))
        .catch(err=>{setExportStatus('');setError(err instanceof Error?err.message:'Falha na exportação filtrada');})
        .finally(()=>setExporting(false));
      }}>{exporting?'Exportando…':'Exportar resultados filtrados XLSX'}</button>
    {canEdit&&<button type="button" className="light-button" onClick={()=>setPermissionsOpen(true)}>Autorizar entrada direta</button>}
    <button type="button" className="light-button" onClick={()=>setFullHistoryOpen(true)}>
      Histórico completo
    </button>
    <button type="button" className="light-button" disabled={Boolean(dirty)}
      onClick={()=>setRefreshKey(n=>n+1)}>Atualizar dados</button>
   </div>
  </div>
  <div className="sheet-controls">
   <label>Buscar produto, SKU ou código
    <input placeholder="Pesquisar no estoque" value={query} disabled={Boolean(dirty)}
      onChange={e=>setQuery(e.target.value)}/>
   </label>
   <label>Categoria
    <select value={category} disabled={Boolean(dirty)} onChange={e=>{setCategory(e.target.value);setOffset(0);}}>
     <option value="">Todas</option>
     {categories.map(c=><option key={c} value={c}>{c}</option>)}
    </select>
   </label>
   <div className="sheet-updated" role="status">
    {loading?'Carregando…':lastUpdated?'Sincronizado às '+lastUpdated:'Aguardando conexão'}
   </div>
  </div>
  <p className="muted small">Selecione qualquer SKU para acessar as ações também em telas pequenas.</p>
  {canEdit&&<p className="muted small">Clique duas vezes em uma célula para editar. Salve ou descarte cada linha antes de passar para outro SKU. Saldo e histórico são somente leitura.</p>}
  {error&&<p role="alert" className="error">{error}</p>}
  {notice&&<p role="status" className="notice">{notice}</p>}
  {exportStatus&&<p role="status" className="notice">{exportStatus}</p>}
  {stale&&<p role="status" className="notice">Há dados novos no servidor. Conclua a edição atual e atualize a planilha.</p>}
  {selectedRow&&<div className="sheet-selection-toolbar" role="group" aria-label="Ações da variante selecionada">
    <div><span className="muted small">Peça selecionada</span><strong>{selectedRow.name} · {selectedRow.sku}</strong></div>
    <div className="workspace-actions">
      {dirty===selectedRow.variant_id?<>
        <button type="button" className="primary-action" disabled={saving}
          onClick={()=>void saveRow(selectedRow)}
          aria-label={'Salvar selecionado '+selectedRow.sku}>Salvar alterações</button>
        <button type="button" className="light-button" disabled={saving||Boolean(pending)}
          onClick={discard}
          aria-label={'Descartar selecionado '+selectedRow.sku}>Descartar</button>
      </>:<>
        {canReceive&&<button className="light-button" type="button" onClick={()=>setAction({kind:'receive',row:selectedRow})}
          aria-label={'Receber selecionado '+selectedRow.sku}>Receber peças</button>}
        {canEdit&&<button className="light-button" type="button" onClick={()=>setAction({kind:'adjust',row:selectedRow})}
          aria-label={'Ajustar selecionado '+selectedRow.sku}>Ajustar estoque</button>}
        <button className="light-button" type="button" onClick={()=>setAction({kind:'history',row:selectedRow})}
          aria-label={'Histórico selecionado '+selectedRow.sku}>Ver histórico</button>
      </>}
    </div>
  </div>}
  <div className="stock-grid-wrap" role="region" tabIndex={0} aria-label="Planilha de produtos e estoque">
   <DataGrid className="rdg-light stock-grid" columns={columns} rows={rows}
     onRowsChange={editRows} onCellClick={args=>setSelectedId(args.row.variant_id)} getRowKey={row=>row.variant_id}
     rowHeight={46} headerRowHeight={50}
     style={{blockSize:'min(65dvh,650px)',minBlockSize:260}}/>
  </div>
  {rows.length===0&&!loading&&!error&&<p className="muted">Nenhuma variante encontrada para os filtros.</p>}
  <footer className="sheet-footer">
   <span>{rows.length} SKUs na página · {total} no filtro · saldo disponível considera reservas</span>
   <div className="workspace-actions">
    <button type="button" className="light-button" disabled={offset===0||Boolean(dirty)||loading}
      onClick={()=>setOffset(x=>Math.max(0,x-limit))}>Anterior</button>
    <button type="button" className="light-button" disabled={offset+rows.length>=total||Boolean(dirty)||loading}
      onClick={()=>setOffset(x=>x+limit)}>Próxima</button>
   </div>
  </footer>
  {bulkOpen&&<SpreadsheetBulkEditor session={session} rows={rows}
   onClose={()=>setBulkOpen(false)}
   onSaved={()=>{setBulkOpen(false);setNotice('Edição em lote registrada no servidor.');setRefreshKey(n=>n+1);onSaved();}}/>}
  {permissionsOpen&&<DirectReceiptPermissions session={session} onClose={()=>setPermissionsOpen(false)}/>}
  {fullHistoryOpen&&<StockMovementHistory session={session} onClose={()=>setFullHistoryOpen(false)}/>}
  {action?.kind==='history'&&<StockMovementHistory session={session}
   variantId={action.row.variant_id} sku={action.row.sku}
   onClose={()=>setAction(null)}/>}
  {action&&action.kind!=='history'&&<TaskDialog
   title={(action.kind==='receive'?'Receber peças':'Ajustar estoque')+' — '+action.row.sku}
   wide onClose={()=>{setAction(null);setHistoryError('');}}>
   {action.kind==='receive'?<>
    {actionLoading&&<p role="status">Localizando a variante no catálogo…</p>}
    {historyError&&<p role="alert" className="error">{historyError}</p>}
    {!actionLoading&&actionProducts.length>0&&
     <ReceiveStockForm key={action.row.variant_id} session={session}
      products={actionProducts} initialVariantId={action.row.variant_id} onSaved={afterStockChange}/>}
   </>:<M2StockAdjustment key={action.row.variant_id} session={session}
      initialSku={action.row.sku} initialVariantId={action.row.variant_id}
      onSaved={afterStockChange} refreshKey={refreshKey}/>}
  </TaskDialog>}
 </div>;
}
