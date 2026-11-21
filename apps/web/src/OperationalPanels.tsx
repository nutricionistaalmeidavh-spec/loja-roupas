import {useEffect,useRef,useState} from 'react';
import {purchaseState} from '@loja/domain/operations';
import type {PurchaseRecord as Purchase,PurchaseReceiptRequest} from '@loja/domain/operations';
import {TaskDialog} from './TaskDialog.tsx';
import type {FormEvent} from 'react';
import {headers,jsonRequest,listCatalog} from './api-client.ts';
import type {Session} from './api-client.ts';
import {reaisToCents} from './catalog-model.ts';
import {receiptText} from './pos-client.ts';
import {requestId} from './request-id.ts';

type Job={id:string;sale_id:string;sale_number:string;paper_mm:number};
type Pickup={id:string;created_at:string;quoted_total_cents:string};
type Supplier={id:string;name:string};
const base='/v1/management/';
const money=(cents:string)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(cents)/100);
const message=(error:unknown)=>error instanceof Error?error.message:'Falha na operação';

export function OperationalPanels({session,suppliers,onStockChanged}:{
  session:Session;suppliers:Supplier[];onStockChanged:()=>void;
}) {
  const [jobs,setJobs]=useState<Job[]>([]);
  const [purchases,setPurchases]=useState<Purchase[]>([]);
  const [pickups,setPickups]=useState<Pickup[]>([]);
  const [query,setQuery]=useState('');
  const [variants,setVariants]=useState<Array<{id:string;sku:string}>>([]);
  const [preview,setPreview]=useState<{job:Job;text:string}|null>(null);
  const [revision,setRevision]=useState(0);
  const [busy,setBusy]=useState(false);
  const [receiving,setReceiving]=useState<Purchase|null>(null);
  const [receivedQty,setReceivedQty]=useState('');
  const [acceptedQty,setAcceptedQty]=useState('');
  const [receiptReason,setReceiptReason]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const pending=useRef(new Map<string,string>());

  useEffect(()=>{
    const controller=new AbortController();
    const init={headers:headers(session),signal:controller.signal};
    void Promise.all([
      jsonRequest<{jobs:Job[]}>(base+'print-queue',init,fetch),
      jsonRequest<{orders:Purchase[]}>(base+'purchases',init,fetch),
      jsonRequest<{orders:Pickup[]}>(base+'pickup-orders',init,fetch),
    ]).then(([printing,buying,orders])=>{
      if(controller.signal.aborted)return;
      setJobs(printing.jobs);setPurchases(buying.orders);setPickups(orders.orders);
    }).catch(error=>{if(!controller.signal.aborted)setError(message(error));});
    return ()=>controller.abort();
  },[session,revision]);

  useEffect(()=>{
    const controller=new AbortController();
    const timeout=window.setTimeout(()=>{
      void listCatalog(session,query,fetch,controller.signal).then(page=>{
        setVariants(page.items.flatMap(product=>product.variants.map(variant=>({id:variant.id,sku:variant.sku}))));
      }).catch(error=>{if(!controller.signal.aborted)setError(message(error));});
    },250);
    return ()=>{clearTimeout(timeout);controller.abort();};
  },[session,query]);

  async function write(path:string,success:string,body?:string,method:'POST'|'PUT'='POST') {
    if(busy)return false;
    setBusy(true);setError('');setNotice('');
    const signature=path+(body??'');
    const key=pending.current.get(signature)??requestId();
    pending.current.set(signature,key);
    try{
      await jsonRequest(base+path,{method,headers:{...headers(session,key),
        ...(body?{'content-type':'application/json'}:{})},body},fetch);
      pending.current.delete(signature);
      setNotice(success);setRevision(value=>value+1);
      return true;
    }catch(error){
      if(error instanceof Error&&'status' in error&&typeof error.status==='number'&&error.status>=400&&error.status<500)
        pending.current.delete(signature);
      setError(message(error));return false;
    }finally{setBusy(false);}
  }

  async function createPurchase(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form=event.currentTarget;
    const values=new FormData(form);
    try{
      const body=JSON.stringify({supplier_id:values.get('supplier'),variant_id:values.get('variant'),
        quantity:Number(values.get('quantity')),unit_cost_cents:reaisToCents(String(values.get('cost'))),
        ...(values.get('promised')?{promised_on:values.get('promised')}:{})});
      if(await write('purchases','Pedido de compra registrado.',body))form.reset();
    }catch(error){setError(message(error));}
  }

  async function loadReceipt(job:Job) {
    if(busy)return;
    setBusy(true);setError('');
    try{setPreview({job,text:await receiptText(session,job.sale_id)});}
    catch(error){setError(message(error));}
    finally{setBusy(false);}
  }

  function printPreview() {
    if(!preview)return;
    document.documentElement.dataset.receiptPaper=String(preview.job.paper_mm);
    try{window.print();}
    finally{delete document.documentElement.dataset.receiptPaper;}
  }

  return <>
    <section>
      <h2>Fila de comprovantes</h2>
      <button className="light-button" disabled={busy} onClick={()=>setRevision(value=>value+1)}>Atualizar filas</button>
      {!jobs.length&&<p>Nenhum comprovante pendente.</p>}
      <ul>{jobs.map(job=><li key={job.id}>Venda {job.sale_number} · {job.paper_mm} mm{' '}
        <button className="light-button" disabled={busy} onClick={()=>void loadReceipt(job)}>Abrir comprovante</button>
      </li>)}</ul>
      {preview&&<div className="editor-block">
        <pre className="receipt-print">{preview.text}</pre>
        <button className="light-button" disabled={busy} onClick={printPreview}>Imprimir na impressora deste terminal</button>{' '}
        <button className="primary-action" disabled={busy} onClick={()=>void write('print-queue/'+preview.job.id+'/complete',
          'Impressão confirmada.').then(ok=>{if(ok)setPreview(null);})}>Confirmar impressão</button>
      </div>}
    </section>
    <section>
      <h2>Pedidos de compra</h2>
      <form onSubmit={event=>void createPurchase(event)}>
        <label>Fornecedor da compra <select aria-label="Fornecedor da compra" name="supplier" required defaultValue="">
          <option value="">Selecione</option>{suppliers.map(supplier=><option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select></label>
        <label>Buscar SKU para compra <input value={query} onChange={event=>setQuery(event.target.value)}/></label>
        <label>Variante da compra <select aria-label="Variante da compra" name="variant" required defaultValue="">
          <option value="">Selecione</option>{variants.map(variant=><option key={variant.id} value={variant.id}>{variant.sku}</option>)}
        </select></label>
        <label>Quantidade da compra <input name="quantity" type="number" required min={1} max={100000}/></label>
        <label>Custo unitário (R$) <input name="cost" inputMode="decimal" required placeholder="0,00"/></label>
        <label>Data prometida <input name="promised" type="date"/></label>
        <button className="primary-action" disabled={busy}>Registrar pedido de compra</button>
      </form>
      <ul>{purchases.map(purchase=><li key={purchase.id}>
        {purchase.supplier} · {purchase.sku} · {purchase.quantity} un. · {money(purchase.unit_cost_cents)} por unidade{' '}
        {purchase.promised_on&&<span>Prazo {purchase.promised_on.split('-').reverse().join('/')} · </span>}
        {purchaseState(purchase)!=='awaiting_receipt'?<div role="status">
          {purchase.quality_finalized
           ? 'Conferido: '+purchase.accepted_quantity+' aprovadas · '+purchase.rejected_quantity+' em quarentena · '+purchase.missing_quantity+' não entregues'
           : 'Recebimento anterior ao controle P0: conferir inventário antes de reclassificar peças'}
        </div>:<button className="light-button" type="button" disabled={busy}
         onClick={()=>{setReceiving(purchase);setReceivedQty('');setAcceptedQty('');setReceiptReason('');}}>
          Conferir recebimento
        </button>}
        
      </li>)}</ul>
    </section>
    {receiving&&purchaseState(receiving)==='awaiting_receipt'&&<TaskDialog title={'Conferir recebimento — '+receiving.sku} busy={busy} onClose={()=>setReceiving(null)}><form className="editor-block" onSubmit={event=>{
          event.preventDefault();
          const payload:PurchaseReceiptRequest={received_quantity:Number(receivedQty),accepted_quantity:Number(acceptedQty),
            ...(receiptReason.trim()?{reason:receiptReason.trim()}:{})};
          const body=JSON.stringify(payload);
          void write('purchases/'+receiving.id+'/receive','Conferência concluída: somente peças aprovadas liberadas.',body)
            .then(ok=>{if(ok){setReceiving(null);onStockChanged();}});
         }}>
          <h3>Conferir entrega de {receiving.sku}</h3>
          <p>Pedido: {receiving.quantity} unidades. Conte e inspecione antes de liberar estoque.</p>
          <label>Quantidade entregue
            <input type="number" inputMode="numeric" required min={1} max={receiving.quantity}
              value={receivedQty} onChange={e=>setReceivedQty(e.target.value)}/></label>
          <label>Quantidade aprovada para venda
            <input type="number" inputMode="numeric" required min={0}
              max={receivedQty||receiving.quantity} value={acceptedQty}
              onChange={e=>setAcceptedQty(e.target.value)}/></label>
          {receivedQty!==''&&acceptedQty!==''&&Number(acceptedQty)<=Number(receivedQty)&&<p role="status">
            {Number(acceptedQty)} liberadas · {Number(receivedQty)-Number(acceptedQty)} em quarentena · {receiving.quantity-Number(receivedQty)} faltantes
          </p>}
          <label>Justificativa (obrigatória se houver divergência)
            <textarea maxLength={250} value={receiptReason} onChange={e=>setReceiptReason(e.target.value)}
              required={receivedQty!==''&&acceptedQty!==''&&
                (Number(acceptedQty)!==Number(receivedQty)||Number(receivedQty)!==receiving.quantity)}/></label>
          <div className="workspace-actions">
            <button type="button" className="light-button" disabled={busy} onClick={()=>setReceiving(null)}>Cancelar</button>
            <button type="submit" className="primary-action" disabled={busy||receivedQty===''||acceptedQty===''||
              Number(acceptedQty)>Number(receivedQty)||Number(receivedQty)>receiving.quantity}>
              Confirmar conferência e liberar aprovadas
            </button>
          </div>
        </form></TaskDialog>}
    <section>
      <h2>Pedidos para retirada pendentes</h2>
      {!pickups.length&&<p>Nenhum pedido pendente.</p>}
      <ul>{pickups.map(pickup=><li key={pickup.id}>
        <code className="pickup-code">{pickup.id}</code> · {money(pickup.quoted_total_cents)}{' '}
        <button className="light-button" disabled={busy}
          onClick={()=>void write('pickup-orders/'+pickup.id+'/cancel','Pedido de retirada cancelado.')}>Cancelar pedido</button>
      </li>)}</ul>
    </section>
    {notice&&<p role="status">{notice}</p>}
    {error&&<p role="alert" className="error">{error}</p>}
  </>;
}
