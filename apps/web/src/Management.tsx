import { requestId } from './request-id.ts';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, createProduct, receiveStock } from './api-client.ts';
import type { Session, ProductPayload, StockReceiptPayload } from './api-client.ts';
import type { Product } from './catalog-model.ts';
import { reaisToCents } from './catalog-model.ts';

type VariantRow = { sku: string; color: string; size: string; price: string; cost: string; barcode: string };
const blankVariant = (): VariantRow => ({ sku: '', color: '', size: '', price: '', cost: '', barcode: '' });
function mutationError(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}
function uncertainResult(error: unknown) {
  return !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
}

export function CreateProductForm({ session, onSaved, onLockChange }: { session: Session; onSaved: () => void; onLockChange?: (locked:boolean)=>void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Feminino');
  const [rows, setRows] = useState<VariantRow[]>([blankVariant()]);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [pending, setPending] = useState<{key:string;body:string} | null>(null);
  useEffect(()=>{onLockChange?.(busy||uncertain);return ()=>onLockChange?.(false);},[busy,uncertain,onLockChange]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  function updateRow(index: number, field: keyof VariantRow, value: string) {
    setRows(current => current.map((row, i) => i === index ? {...row, [field]:value} : row));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setNotice('');
    let payload: ProductPayload;
    try {
      payload = {
        name: name.trim(),
        category: category.trim(),
        variants: rows.map(row => ({
          sku: row.sku.trim(), color: row.color.trim(), size: row.size.trim(),
          price_cents: reaisToCents(row.price), ...(row.barcode.trim() ? {barcode:row.barcode.trim()} : {}),
          ...(row.cost.trim() ? {cost_cents:reaisToCents(row.cost)} : {}),
        })),
      };
      if (!payload.name || !payload.category || payload.variants.some(v => !v.sku || !v.color || !v.size))
        throw new Error('Preencha nome, categoria, SKU, cor e tamanho de todas as variantes.');
      if (payload.variants.some(v => v.price_cents <= 0))
        throw new Error('O preço de venda precisa ser maior que zero. Para brindes, use um valor simbólico e aplique desconto na venda.');
    } catch (err) { setError(mutationError(err)); return; }
    const body = JSON.stringify(payload);
    if (pending && pending.body !== body && uncertain) {
      setError('Há uma resposta pendente. Repita a operação sem alterar os campos.');
      return;
    }
    const key = pending?.body === body ? pending.key : requestId();
    setPending({key,body});
    setBusy(true);
    try {
      const created = await createProduct(session,payload,key);
      setName('');
      setRows([blankVariant()]);
      setPending(null);
      setUncertain(false);
      setNotice('Produto cadastrado: '+payload.name+'. Consulte o catálogo para conferir as variantes.');
      onSaved();
    } catch(err) {
      setError(mutationError(err));
      if (uncertainResult(err)) setUncertain(true);
      else { setPending(null); setUncertain(false); }
    } finally { setBusy(false); }
  }
  return <form className="management-form" onSubmit={event=>void submit(event)}>
    <div className="form-heading"><h2>Cadastrar produto</h2><p>Cadastre o produto e suas variações reais no PostgreSQL. O estoque começa em zero.</p></div>
    <div className="fields-two">
      <label>Nome da peça<input required maxLength={200} placeholder="Ex.: Camisa de linho" value={name} disabled={busy||uncertain} onChange={e=>setName(e.target.value)}/></label>
      <label>Categoria<select value={category} disabled={busy||uncertain} onChange={e=>setCategory(e.target.value)}>
        {['Feminino','Masculino','Acessórios','Infantil','Unissex'].map(c=><option key={c}>{c}</option>)}
      </select></label>
    </div>
    <div className="subhead"><h3>Grade de variantes</h3><span>SKU único por cor e tamanho</span></div>
    {rows.map((row,index)=><fieldset className="variant-row" key={index} disabled={busy||uncertain}>
      <legend>Variante {index+1}</legend>
      <div className="variant-fields">
        <label>SKU<input required maxLength={64} placeholder="CAM-AZ-M" value={row.sku} onChange={e=>updateRow(index,'sku',e.target.value)}/></label>
        <label>Cor<input required maxLength={100} placeholder="Azul" value={row.color} onChange={e=>updateRow(index,'color',e.target.value)}/></label>
        <label>Tamanho<input required maxLength={32} placeholder="M" value={row.size} onChange={e=>updateRow(index,'size',e.target.value)}/></label>
        <label>Preço (R$)<input required inputMode="decimal" placeholder="149,90" value={row.price} onChange={e=>updateRow(index,'price',e.target.value)}/></label>
        <label>Custo (R$, opcional)<input inputMode="decimal" placeholder="60,00" value={row.cost} onChange={e=>updateRow(index,'cost',e.target.value)}/></label>
        <label>Código de barras (opcional)<input maxLength={128} placeholder="EAN" value={row.barcode} onChange={e=>updateRow(index,'barcode',e.target.value)}/></label>
      </div>
      {rows.length>1&&<button type="button" className="light-button" onClick={()=>setRows(x=>x.filter((_,i)=>i!==index))}>Remover variante</button>}
    </fieldset>)}
    <button type="button" disabled={busy||uncertain||rows.length>=200} className="light-button" onClick={()=>setRows(r=>[...r,blankVariant()])}>+ Adicionar cor/tamanho</button>
    {error&&<p className="error" role="alert">{error}{uncertain&&' O servidor pode ter concluído. Use a mesma chave ao tentar novamente.'}</p>}
    {notice&&<p className="notice" role="status">{notice}</p>}
    <button className="primary-action" type="submit" disabled={busy}>{busy?'Salvando…':uncertain?'Repetir mesma solicitação':'Cadastrar produto'}</button>
  </form>;
}

export function ReceiveStockForm({ session, products, onSaved, initialVariantId = '', onLockChange }: { session: Session; products: Product[]; onSaved: () => void; initialVariantId?: string; onLockChange?: (locked:boolean)=>void }) {
  const [variantId, setVariantId] = useState(initialVariantId);
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [cost, setCost] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [pending, setPending] = useState<{key:string;body:string} | null>(null);
  useEffect(()=>{onLockChange?.(busy||uncertain);return ()=>onLockChange?.(false);},[busy,uncertain,onLockChange]);
  const [referenceId,setReferenceId] = useState(()=>requestId());
  const [notice,setNotice] = useState('');
  const [error,setError] = useState('');
  const variants = products.flatMap(p=>p.variants.map(v=>({label:`${p.name} · ${v.color} · ${v.size} · ${v.sku} (saldo ${v.available})`,id:v.id})));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(''); setNotice('');
    const amount=Number(quantity);
    if (!variantId || !Number.isSafeInteger(amount) || amount<=0) {
      setError('Selecione uma variante e informe quantidade inteira positiva.');
      return;
    }
    if(note.trim().length<8){setError('Justifique a entrada direta com pelo menos 8 caracteres.');return;}
    let unitCost:number|undefined;
    try{unitCost=cost.trim()?reaisToCents(cost):undefined;}catch(err){setError(mutationError(err));return;}
    const payload:StockReceiptPayload={variant_id:variantId,reference_id:referenceId,quantity:amount,
      ...(note.trim()?{note:note.trim()}:{}),...(unitCost!==undefined?{unit_cost_cents:unitCost}:{})};
    const body=JSON.stringify(payload);
    if (pending && pending.body!==body && uncertain) {
      setError('Há uma entrada pendente. Repita sem alterar os dados.');
      return;
    }
    const key=pending?.body===body?pending.key:requestId();
    setPending({key,body});
    setBusy(true);
    try {
      const result=await receiveStock(session,payload,key);
      setNotice(`Entrada registrada. Novo saldo em mãos: ${result.on_hand} unidades.`);
      setPending(null);setUncertain(false);setReferenceId(requestId());
      setNote('');setCost('');setQuantity('1');onSaved();
    } catch(err) {
      setError(mutationError(err));
      if(uncertainResult(err)) setUncertain(true);
      else {setPending(null);setUncertain(false);}
    } finally {setBusy(false);}
  }
  return <form className="management-form" onSubmit={event=>void submit(event)}>
    <div className="form-heading"><h2>Entrada de estoque</h2><p>Operação excepcional: libera saldo para venda imediatamente. Exige autorização individual e justificativa; não conclui pedidos de compra.</p></div>
    <div className="fields-two">
      <label>Variante (SKU)<select required value={variantId} disabled={busy||uncertain} onChange={e=>setVariantId(e.target.value)}>
        <option value="">Selecione uma variante</option>
        {variants.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}
      </select></label>
      <label>Quantidade recebida<input required type="number" min="1" step="1" value={quantity} disabled={busy||uncertain} onChange={e=>setQuantity(e.target.value)}/></label>
      <label>Custo por peça (R$, opcional)<input inputMode="decimal" placeholder="Atualiza o custo da variante" value={cost} disabled={busy||uncertain} onChange={e=>setCost(e.target.value)}/></label>
    </div>
    <label>Justificativa obrigatória<input required minLength={8} maxLength={250} value={note} disabled={busy||uncertain} placeholder="Descreva a origem e por que a entrada é excepcional" onChange={e=>setNote(e.target.value)}/></label>
    <p className="muted small">Referência da entrada: {referenceId}. Será usada para impedir duplicidade após reenvio.</p>
    {error&&<p className="error" role="alert">{error}{uncertain&&' A operação pode ter sido gravada. Repita com a mesma chave.'}</p>}
    {notice&&<p className="notice" role="status">{notice}</p>}
    <button type="submit" className="primary-action" disabled={busy||!variants.length}>
      {busy?'Registrando…':uncertain?'Repetir mesma entrada':'Confirmar entrada direta'}
    </button>
    {!variants.length&&<p className="muted">Cadastre um produto antes de lançar entradas de estoque.</p>}
  </form>;
}
