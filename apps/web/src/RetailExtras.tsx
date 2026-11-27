import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { headers, jsonRequest } from './api-client.ts';
import type { Session } from './api-client.ts';
import { brl, errorText, sendOnce } from './idempotent-post.ts';
import type { Pending } from './idempotent-post.ts';

/*
 * Telas das funções de loja de roupa: condicional (malinha), promoções,
 * relatórios de moda e aniversariantes do mês com WhatsApp.
 */
export type CartLine = { variant_id: string; quantity: number };
type ConsignmentLine = { variant_id: string; quantity: number; kept_quantity: number | null; sku: string; color: string; size: string; product_name: string; price_cents: number };
type Consignment = { id: string; number: number; status: string; due_on: string; note: string | null; customer_name: string; customer_phone: string | null; overdue: boolean; lines: ConsignmentLine[] };
type Customer = { id: string; name: string; phone: string | null };
const day = (iso: string) => iso.split('-').reverse().join('/');
const inDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

/** Busca de cliente com cadastro rápido, usada no condicional. */
function CustomerPicker({ session, value, onChange }: { session: Session; value: Customer | null; onChange: (c: Customer | null) => void }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Customer[]>([]);
  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      const q = new URLSearchParams({ limit: '20', ...(query.trim() ? { q: query.trim() } : {}) });
      void jsonRequest<{ items: Customer[] }>('/v1/management/customers?' + q, { headers: headers(session), signal: ctrl.signal }, fetch)
        .then(r => { if (!ctrl.signal.aborted) setItems(r.items); }).catch(() => {});
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [session, query]);
  return <div className="fields-two">
    <label>Buscar cliente<input value={query} placeholder="Nome ou telefone" onChange={e => setQuery(e.target.value)} /></label>
    <label>Cliente do condicional
      <select required value={value?.id ?? ''} onChange={e => onChange(items.find(c => c.id === e.target.value) ?? null)}>
        <option value="">Escolha a cliente</option>
        {value && !items.some(c => c.id === value.id) && <option value={value.id}>{value.name}</option>}
        {items.map(c => <option key={c.id} value={c.id}>{c.name}{c.phone ? ' · ' + c.phone : ''}</option>)}
      </select></label>
  </div>;
}

/** Abre um condicional com as peças do carrinho. */
export function ConsignmentCreate({ session, lines, describe, onCreated }: {
  session: Session; lines: readonly CartLine[]; describe: (variantId: string) => string; onCreated: (number: number) => void;
}) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [due, setDue] = useState(inDays(3));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef<Pending>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    if (!customer) { setError('Escolha a cliente que vai levar as peças.'); return; }
    setBusy(true); setError('');
    try {
      const out = await sendOnce<{ number: number }>(session, 'POST', '/v1/consignments', { customer_id: customer.id, due_on: due, ...(note.trim() ? { note: note.trim() } : {}), lines }, pending);
      onCreated(out.number);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <form className="management-form" onSubmit={e => void submit(e)}>
    <p>A cliente leva as peças para provar em casa. Elas ficam reservadas até a devolução e não aparecem como disponíveis para outra venda.</p>
    <ul className="consignment-lines">{lines.map(l => <li key={l.variant_id}>{l.quantity} × {describe(l.variant_id)}</li>)}</ul>
    <CustomerPicker session={session} value={customer} onChange={setCustomer} />
    <div className="fields-two">
      <label>Devolver até<input type="date" required min={inDays(0)} max={inDays(30)} value={due} onChange={e => setDue(e.target.value)} /></label>
      <label>Observação (opcional)<input maxLength={240} value={note} placeholder="Ex.: vai provar com a família" onChange={e => setNote(e.target.value)} /></label>
    </div>
    {error && <p role="alert" className="error">{error}</p>}
    <button className="primary-action" disabled={busy || !lines.length}>{busy ? 'Salvando…' : 'Abrir condicional'}</button>
  </form>;
}

/** Condicionais em aberto; ao fechar, as peças devolvidas voltam ao estoque e as que ficaram vão para o carrinho. */
export function ConsignmentList({ session, onToCart }: { session: Session; onToCart: (lines: CartLine[]) => void }) {
  const [items, setItems] = useState<Consignment[] | null>(null);
  const [closing, setClosing] = useState<Consignment | null>(null);
  const [kept, setKept] = useState<Record<string, number>>({});
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const pending = useRef<Pending>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    void jsonRequest<{ items: Consignment[] }>('/v1/consignments', { headers: headers(session), signal: ctrl.signal }, fetch)
      .then(r => { if (!ctrl.signal.aborted) setItems(r.items); }).catch(e => { if (!ctrl.signal.aborted) setError(errorText(e)); });
    return () => ctrl.abort();
  }, [session, revision]);
  async function close(event: FormEvent) {
    event.preventDefault(); if (!closing || busy) return;
    setBusy(true); setError('');
    try {
      const out = await sendOnce<{ kept: CartLine[] }>(session, 'POST', '/v1/consignments/' + closing.id + '/close',
        { lines: closing.lines.map(l => ({ variant_id: l.variant_id, kept_quantity: kept[l.variant_id] ?? 0 })) }, pending);
      setClosing(null); setRevision(n => n + 1);
      if (out.kept.length) onToCart(out.kept);
      else setNotice('Condicional fechado. Todas as peças voltaram para o estoque.');
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <section className="management-section" aria-label="Condicionais em aberto">
    <h2>Condicional (malinha)</h2>
    <p>Para abrir um condicional, monte o carrinho no PDV e use “Levar como condicional”.</p>
    {notice && <p role="status">{notice}</p>}{error && !closing && <p role="alert" className="error">{error}</p>}
    {items === null ? <p role="status">Carregando condicionais…</p> : !items.length ? <p className="muted">Nenhum condicional em aberto.</p> :
      <div className="management-table-scroll" role="region" aria-label="Lista de condicionais" tabIndex={0}>
        <table><thead><tr><th>Nº</th><th>Cliente</th><th>Peças</th><th>Devolver até</th><th></th></tr></thead>
          <tbody>{items.map(c => <tr key={c.id} className={c.overdue ? 'overdue' : ''}>
            <td>{c.number}</td><td>{c.customer_name}{c.customer_phone ? <span className="muted small"> · {c.customer_phone}</span> : null}</td>
            <td>{c.lines.reduce((n, l) => n + l.quantity, 0)}</td>
            <td>{day(c.due_on)}{c.overdue && <strong className="tag-warning"> atrasado</strong>}</td>
            <td><button type="button" className="light-button" onClick={() => { setClosing(c); setKept({}); setError(''); setNotice(''); }}>Fechar condicional {c.number}</button></td>
          </tr>)}</tbody></table>
      </div>}
    {closing && <form className="editor-block" onSubmit={e => void close(e)} aria-label={'Fechar condicional ' + closing.number}>
      <h3>Fechar condicional {closing.number} · {closing.customer_name}</h3>
      <p className="muted small">Informe quantas peças a cliente vai ficar. O resto volta para o estoque.</p>
      {closing.lines.map(l => <label key={l.variant_id}>{l.product_name} · {l.color} {l.size} ({l.quantity} levada{l.quantity > 1 ? 's' : ''}) · {brl(l.price_cents)}
        <input type="number" min={0} max={l.quantity} aria-label={'Ficou com ' + l.sku} value={kept[l.variant_id] ?? 0}
          onChange={e => setKept(k => ({ ...k, [l.variant_id]: Math.max(0, Math.min(l.quantity, Number(e.target.value) || 0)) }))} /></label>)}
      {error && <p role="alert" className="error">{error}</p>}
      <div className="checkout-buttons">
        <button type="button" className="light-button" disabled={busy} onClick={() => setClosing(null)}>Cancelar</button>
        <button className="primary-action" disabled={busy}>{busy ? 'Fechando…' : Object.values(kept).some(n => n > 0) ? 'Fechar e levar ao caixa' : 'Fechar: devolveu tudo'}</button>
      </div>
    </form>}
  </section>;
}

type Promotion = { id: string; name: string; kind: 'percent' | 'buy_x_pay_y'; category: string | null; percent_bps: number | null;
  buy_quantity: number | null; pay_quantity: number | null; starts_on: string; ends_on: string; active: boolean; running: boolean };
export function PromotionsPanel({ session }: { session: Session }) {
  const [items, setItems] = useState<Promotion[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [kind, setKind] = useState<'percent' | 'buy_x_pay_y'>('percent');
  const [name, setName] = useState(''), [category, setCategory] = useState(''), [percent, setPercent] = useState('20');
  const [buy, setBuy] = useState(3), [pay, setPay] = useState(2), [start, setStart] = useState(inDays(0)), [end, setEnd] = useState(inDays(7));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const pending = useRef<Pending>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    void jsonRequest<{ items: Promotion[] }>('/v1/promotions', { headers: headers(session), signal: ctrl.signal }, fetch)
      .then(r => { if (!ctrl.signal.aborted) setItems(r.items); }).catch(e => { if (!ctrl.signal.aborted) setError(errorText(e)); });
    void jsonRequest<{ items?: string[]; categories?: string[] } | string[]>('/v1/catalog/categories', { headers: headers(session), signal: ctrl.signal }, fetch)
      .then(r => { if (!ctrl.signal.aborted) setCategories(Array.isArray(r) ? r : r.items ?? r.categories ?? []); }).catch(() => {});
    return () => ctrl.abort();
  }, [session, revision]);
  async function create(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setError(''); setNotice('');
    const pct = Number(percent.replace(',', '.'));
    if (kind === 'percent' && (!Number.isFinite(pct) || pct <= 0 || pct > 90)) { setError('O percentual precisa ficar entre 1% e 90%.'); return; }
    setBusy(true);
    try {
      await sendOnce(session, 'POST', '/v1/promotions', { name: name.trim(), kind, category: category || null, starts_on: start, ends_on: end,
        ...(kind === 'percent' ? { percent_bps: Math.round(pct * 100) } : { buy_quantity: buy, pay_quantity: pay }) }, pending);
      setNotice('Promoção criada. O caixa já aplica o desconto sozinho.'); setName(''); setRevision(n => n + 1);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function finish(p: Promotion) {
    if (busy) return; setBusy(true); setError('');
    try { await sendOnce(session, 'POST', '/v1/promotions/' + p.id + '/end', {}, { current: null }); setRevision(n => n + 1); setNotice('Promoção encerrada.'); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  const describe = (p: Promotion) => (p.kind === 'percent' ? ((p.percent_bps ?? 0) / 100).toLocaleString('pt-BR') + '% de desconto' : 'Leve ' + p.buy_quantity + ' pague ' + p.pay_quantity)
    + ' · ' + (p.category ?? 'loja toda');
  return <section className="management-section" aria-label="Promoções">
    <h2>Promoções</h2>
    <p>O desconto entra sozinho no caixa durante o período e aparece na notinha. Não conta no limite de desconto do caixa.</p>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="error">{error}</p>}
    <form className="management-form" onSubmit={e => void create(e)}>
      <div className="fields-two">
        <label>Nome da promoção<input required minLength={3} maxLength={80} value={name} placeholder="Ex.: Liquidação de verão" onChange={e => setName(e.target.value)} /></label>
        <label>Tipo<select value={kind} onChange={e => setKind(e.target.value as Promotion['kind'])}>
          <option value="percent">% de desconto</option><option value="buy_x_pay_y">Leve X pague Y</option></select></label>
        <label>Categoria<select value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">Loja toda</option>{categories.filter(c => c !== 'Todos').map(c => <option key={c} value={c}>{c}</option>)}</select></label>
        {kind === 'percent' ? <label>Desconto (%)<input inputMode="decimal" required value={percent} onChange={e => setPercent(e.target.value)} /></label>
          : <div className="fields-two"><label>Leve<input type="number" min={2} max={20} value={buy} onChange={e => setBuy(Number(e.target.value))} /></label>
            <label>Pague<input type="number" min={1} max={Math.max(1, buy - 1)} value={pay} onChange={e => setPay(Number(e.target.value))} /></label></div>}
        <label>Começa em<input type="date" required value={start} onChange={e => setStart(e.target.value)} /></label>
        <label>Termina em<input type="date" required min={start} value={end} onChange={e => setEnd(e.target.value)} /></label>
      </div>
      <button className="primary-action" disabled={busy}>Criar promoção</button>
    </form>
    {items.length > 0 && <div className="management-table-scroll" role="region" aria-label="Lista de promoções" tabIndex={0}>
      <table><thead><tr><th>Promoção</th><th>Regra</th><th>Período</th><th>Situação</th><th></th></tr></thead>
        <tbody>{items.map(p => <tr key={p.id}><td>{p.name}</td><td>{describe(p)}</td><td>{day(p.starts_on)} a {day(p.ends_on)}</td>
          <td>{!p.active ? 'Encerrada' : p.running ? 'Valendo agora' : 'Agendada'}</td>
          <td>{p.active && <button type="button" className="light-button" disabled={busy} onClick={() => void finish(p)}>Encerrar</button>}</td></tr>)}</tbody></table>
    </div>}
  </section>;
}

type Fashion = { days: number; stale_days: number; total_revenue_cents: number;
  abc: Array<{ product_id: string; name: string; category: string; units: number; revenue_cents: number; share_bps: number; class: 'A' | 'B' | 'C' }>;
  stale: Array<{ variant_id: string; sku: string; name: string; color: string; size: string; on_hand: number; days_without_sale: number }>;
  by_size: Array<{ value: string; sold: number; on_hand: number; sell_through_bps: number }>;
  by_color: Array<{ value: string; sold: number; on_hand: number; sell_through_bps: number }> };
const pct = (bps: number) => (bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
export function FashionReports({ session }: { session: Session }) {
  const [days, setDays] = useState(90), [staleDays, setStaleDays] = useState(60);
  const [data, setData] = useState<Fashion | null>(null), [error, setError] = useState('');
  useEffect(() => {
    const ctrl = new AbortController(); setData(null);
    void jsonRequest<Fashion>('/v1/reports/fashion?days=' + days + '&stale_days=' + staleDays, { headers: headers(session), signal: ctrl.signal }, fetch)
      .then(r => { if (!ctrl.signal.aborted) setData(r); }).catch(e => { if (!ctrl.signal.aborted) setError(errorText(e)); });
    return () => ctrl.abort();
  }, [session, days, staleDays]);
  const turnover = (title: string, rows: Fashion['by_size']) => <div className="management-table-scroll" role="region" aria-label={title} tabIndex={0}>
    <table><caption>{title}</caption><thead><tr><th></th><th>Vendidas</th><th>Em estoque</th><th>Giro</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.value}><td>{r.value}</td><td>{r.sold}</td><td>{r.on_hand}</td>
        <td><span className="bar" style={{ width: Math.max(4, r.sell_through_bps / 100) + '%' }} />{pct(r.sell_through_bps)}</td></tr>)}</tbody></table></div>;
  return <section className="management-section fashion-reports" aria-label="Relatórios de moda">
    <h2>Relatórios de moda</h2>
    <div className="fields-two">
      <label>Período das vendas<select value={days} onChange={e => setDays(Number(e.target.value))}>
        {[30, 60, 90, 180, 365].map(d => <option key={d} value={d}>Últimos {d} dias</option>)}</select></label>
      <label>Peça parada há mais de<select value={staleDays} onChange={e => setStaleDays(Number(e.target.value))}>
        {[30, 60, 90, 120].map(d => <option key={d} value={d}>{d} dias</option>)}</select></label>
    </div>
    {error && <p role="alert" className="error">{error}</p>}
    {!data ? !error && <p role="status">Montando relatórios…</p> : <>
      <h3>Curva ABC</h3>
      <p className="muted small">A: peças que fazem 80% do faturamento (nunca deixe faltar). B: os próximos 15%. C: o resto (compre com cuidado).</p>
      {data.abc.length ? <div className="management-table-scroll" role="region" aria-label="Curva ABC" tabIndex={0}>
        <table><thead><tr><th>Classe</th><th>Produto</th><th>Categoria</th><th>Peças</th><th>Faturamento</th><th>Participação</th></tr></thead>
          <tbody>{data.abc.map(r => <tr key={r.product_id}><td><strong className={'abc abc-' + r.class}>{r.class}</strong></td><td>{r.name}</td><td>{r.category}</td>
            <td>{r.units}</td><td>{brl(r.revenue_cents)}</td><td>{pct(r.share_bps)}</td></tr>)}</tbody></table></div>
        : <p className="muted">Sem vendas no período.</p>}
      <h3>Peças paradas</h3>
      <p className="muted small">Com estoque e sem venda há mais de {data.stale_days} dias. Boas candidatas a promoção.</p>
      {data.stale.length ? <div className="management-table-scroll" role="region" aria-label="Peças paradas" tabIndex={0}>
        <table><thead><tr><th>Peça</th><th>Cor</th><th>Tamanho</th><th>Estoque</th><th>Dias sem vender</th></tr></thead>
          <tbody>{data.stale.map(r => <tr key={r.variant_id}><td>{r.name} <span className="muted small">{r.sku}</span></td><td>{r.color}</td><td>{r.size}</td>
            <td>{r.on_hand}</td><td>{r.days_without_sale}</td></tr>)}</tbody></table></div>
        : <p className="muted">Nenhuma peça parada. Ótimo giro!</p>}
      <h3>Giro por grade</h3>
      <p className="muted small">Giro = vendidas ÷ (vendidas + estoque). Tamanhos e cores com giro alto pedem mais peças na próxima compra.</p>
      <div className="fashion-turnover">{turnover('Por tamanho', data.by_size)}{turnover('Por cor', data.by_color)}</div>
    </>}
  </section>;
}

type Birthday = { id: string; name: string; phone: string | null; marketing_consent: boolean; day: number };
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export function whatsappLink(phone: string, text: string) {
  const digits = phone.replace(/\D/g, '');
  const full = digits.length <= 11 ? '55' + digits : digits;
  return 'https://wa.me/' + full + '?text=' + encodeURIComponent(text);
}
export function BirthdayList({ session, storeName }: { session: Session; storeName: string }) {
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [items, setItems] = useState<Birthday[] | null>(null), [error, setError] = useState('');
  useEffect(() => {
    const ctrl = new AbortController(); setItems(null);
    void jsonRequest<{ items: Birthday[] }>('/v1/customers/birthdays?month=' + month, { headers: headers(session), signal: ctrl.signal }, fetch)
      .then(r => { if (!ctrl.signal.aborted) setItems(r.items); }).catch(e => { if (!ctrl.signal.aborted) setError(errorText(e)); });
    return () => ctrl.abort();
  }, [session, month]);
  return <section className="management-section" aria-label="Aniversariantes">
    <h2>Aniversariantes</h2>
    <label>Mês<select value={month} onChange={e => setMonth(Number(e.target.value))}>
      {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m[0].toUpperCase() + m.slice(1)}</option>)}</select></label>
    <p className="muted small">O botão abre o WhatsApp com a mensagem pronta; você revisa e envia. Só aparece para quem autorizou receber mensagens.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {items === null ? !error && <p role="status">Carregando…</p> : !items.length ? <p className="muted">Nenhuma cliente faz aniversário em {MONTHS[month - 1]}. Cadastre o aniversário no cadastro de clientes.</p> :
      <ul className="birthday-list">{items.map(c => <li key={c.id}>
        <strong>{String(c.day).padStart(2, '0')}/{String(month).padStart(2, '0')}</strong> {c.name}
        {c.phone && c.marketing_consent ? <a className="light-button" target="_blank" rel="noreferrer"
          href={whatsappLink(c.phone, 'Oi, ' + c.name.split(' ')[0] + '! A ' + storeName + ' deseja um feliz aniversário! 🎉 Passe na loja este mês: temos um mimo para você.')}>
          Mandar parabéns no WhatsApp</a> : <span className="muted small">{c.phone ? 'Sem autorização para mensagens' : 'Sem telefone'}</span>}
      </li>)}</ul>}
  </section>;
}
