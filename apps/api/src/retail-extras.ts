import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { requirePermission } from './auth.ts';
import { hasPermission } from './security.ts';
import { DomainError, requireIdempotencyKey, withIdempotentTransaction } from './transactions.ts';

/*
 * Funções de loja de roupa pedidas na avaliação de produto (27/11/2026):
 * condicional (malinha), promoções automáticas, relatórios de moda e aniversariantes.
 */
const uuid = { type: 'string', pattern: '^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$' };
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
type Q = Pick<PoolClient, 'query'>;

function validDate(value: string, label: string) {
  const d = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new DomainError(422, 'BAD_DATE', label + ' inválida.');
  return value;
}
function requireAny(request: FastifyRequest, reply: FastifyReply, permissions: readonly string[]) {
  const roles = request.authContext?.roles ?? [];
  if (!permissions.some(p => hasPermission(roles, p))) return reply.code(403).send({ code: 'FORBIDDEN', message: 'Permissão insuficiente' });
}
async function stockChanged(db: Q, storeId: string, variantId: string, revision: string, payload: object) {
  await db.query(`INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload)
    VALUES($1,'inventory.stock.changed.v1',$2,$3,$4::jsonb)`, [storeId, variantId, Number(revision), JSON.stringify(payload)]);
}

type ConsignmentRow = { id: string; number: string; status: string; due_on: string; note: string | null; created_at: Date;
  closed_at: Date | null; customer_id: string; customer_name: string; customer_phone: string | null; overdue: boolean };
async function readConsignments(db: Q, storeId: string, where: string, args: unknown[]) {
  const head = await db.query<ConsignmentRow>(`SELECT c.id::text,c.number::text,c.status,to_char(c.due_on,'YYYY-MM-DD') AS due_on,c.note,
     c.created_at,c.closed_at,c.customer_id::text,r.name AS customer_name,r.phone AS customer_phone,
     (c.status='open' AND c.due_on<current_date) AS overdue
    FROM retail_consignments c JOIN retail_customers r ON r.id=c.customer_id AND r.store_id=c.store_id
    WHERE c.store_id=$1 ${where} ORDER BY c.status, c.due_on, c.number LIMIT 200`, [storeId, ...args]);
  if (!head.rowCount) return [];
  const lines = await db.query<{ consignment_id: string; variant_id: string; quantity: number; kept_quantity: number | null;
    sku: string; color: string; size: string; product_name: string; price_cents: string }>(`SELECT l.consignment_id::text,l.variant_id::text,
     l.quantity,l.kept_quantity,v.sku,v.color,v.size,p.name AS product_name,v.price_cents::text
    FROM retail_consignment_lines l JOIN product_variants v ON v.id=l.variant_id AND v.store_id=l.store_id
    JOIN products p ON p.id=v.product_id AND p.store_id=v.store_id
    WHERE l.store_id=$1 AND l.consignment_id=ANY($2::uuid[]) ORDER BY p.name,v.sku`, [storeId, head.rows.map(r => r.id)]);
  return head.rows.map(c => ({ ...c, number: Number(c.number),
    lines: lines.rows.filter(l => l.consignment_id === c.id).map(({ consignment_id: _, ...l }) => ({ ...l, price_cents: Number(l.price_cents) })) }));
}

export function registerRetailExtras(app: FastifyInstance, db: Pool) {
  /* ---------- Condicional (malinha) ---------- */
  const consignmentPermissions = ['reservation.create', 'sale.commit'];
  app.get<{ Querystring: { status?: 'open' | 'closed' } }>('/v1/consignments', {
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { status: { type: 'string', enum: ['open', 'closed'] } } } },
  }, async (request, reply) => {
    if (requireAny(request, reply, consignmentPermissions)) return reply;
    const items = await readConsignments(db, request.authContext!.storeId, 'AND c.status=$2', [request.query.status ?? 'open']);
    return { items };
  });

  app.post<{ Body: { customer_id: string; due_on: string; note?: string; lines: Array<{ variant_id: string; quantity: number }> } }>('/v1/consignments', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['customer_id', 'due_on', 'lines'], properties: {
      customer_id: uuid, due_on: date, note: { type: 'string', maxLength: 240 },
      lines: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', additionalProperties: false, required: ['variant_id', 'quantity'],
        properties: { variant_id: uuid, quantity: { type: 'integer', minimum: 1, maximum: 99 } } } } } } },
  }, async (request, reply) => {
    if (requireAny(request, reply, consignmentPermissions)) return reply;
    const auth = request.authContext!, body = request.body;
    validDate(body.due_on, 'Data de devolução');
    const ids = body.lines.map(l => l.variant_id.toLowerCase());
    if (new Set(ids).size !== ids.length) throw new DomainError(422, 'DUPLICATE_LINE', 'Junte as peças repetidas numa linha só.');
    const out = await withIdempotentTransaction(db, auth, 'consignment.create', requireIdempotencyKey(request.headers['idempotency-key']), body, async client => {
      const today = await client.query<{ ok: boolean }>(`SELECT $2::date>=current_date AND $2::date<=current_date+30 AS ok FROM stores WHERE id=$1`, [auth.storeId, body.due_on]);
      if (!today.rows[0]?.ok) throw new DomainError(422, 'BAD_DUE', 'A data de devolução precisa ser de hoje até 30 dias.');
      const customer = await client.query(`SELECT 1 FROM retail_customers WHERE store_id=$1 AND id=$2 AND anonymized_at IS NULL`, [auth.storeId, body.customer_id]);
      if (!customer.rowCount) throw new DomainError(404, 'CUSTOMER_NOT_FOUND', 'Cliente não encontrada');
      const num = await client.query<{ last_number: string }>(`INSERT INTO store_counters(store_id,counter_name,last_number)
        VALUES($1,'consignment',1) ON CONFLICT(store_id,counter_name) DO UPDATE SET last_number=store_counters.last_number+1
        RETURNING last_number::text`, [auth.storeId]);
      const created = await client.query<{ id: string }>(`INSERT INTO retail_consignments(store_id,number,customer_id,due_on,note,created_by)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text`, [auth.storeId, Number(num.rows[0].last_number), body.customer_id, body.due_on, body.note?.trim() || null, auth.userId]);
      const id = created.rows[0].id;
      for (const line of [...body.lines].sort((a, b) => a.variant_id.localeCompare(b.variant_id))) {
        const b = await client.query<{ revision: string }>(`UPDATE stock_balances SET reserved=reserved+$3,revision=revision+1
          WHERE store_id=$1 AND variant_id=$2 AND on_hand-reserved>=$3 RETURNING revision::text`, [auth.storeId, line.variant_id, line.quantity]);
        if (!b.rowCount) {
          const sku = await client.query<{ sku: string }>('SELECT sku FROM product_variants WHERE store_id=$1 AND id=$2', [auth.storeId, line.variant_id]);
          throw new DomainError(409, 'OUT_OF_STOCK', 'Sem estoque suficiente de ' + (sku.rows[0]?.sku ?? 'uma peça') + ' para o condicional.');
        }
        await client.query(`INSERT INTO retail_consignment_lines(store_id,consignment_id,variant_id,quantity) VALUES($1,$2,$3,$4)`,
          [auth.storeId, id, line.variant_id, line.quantity]);
        await stockChanged(client, auth.storeId, line.variant_id, b.rows[0].revision, { consignment_id: id, reserved_delta: line.quantity });
      }
      await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail) VALUES($1,$2,'consignment.create',$3,$4::jsonb)`,
        [auth.storeId, auth.userId, id, JSON.stringify(body)]);
      return (await readConsignments(client, auth.storeId, 'AND c.id=$2', [id]))[0];
    });
    return reply.code(out.replayed ? 200 : 201).send(out.result);
  });

  app.post<{ Params: { id: string }; Body: { lines: Array<{ variant_id: string; kept_quantity: number }> } }>('/v1/consignments/:id/close', {
    schema: { params: { type: 'object', required: ['id'], properties: { id: uuid } },
      body: { type: 'object', additionalProperties: false, required: ['lines'], properties: {
        lines: { type: 'array', maxItems: 30, items: { type: 'object', additionalProperties: false, required: ['variant_id', 'kept_quantity'],
          properties: { variant_id: uuid, kept_quantity: { type: 'integer', minimum: 0, maximum: 99 } } } } } } },
  }, async (request, reply) => {
    if (requireAny(request, reply, consignmentPermissions)) return reply;
    const auth = request.authContext!, id = request.params.id;
    const out = await withIdempotentTransaction(db, auth, 'consignment.close:' + id, requireIdempotencyKey(request.headers['idempotency-key']), request.body, async client => {
      const head = await client.query(`SELECT 1 FROM retail_consignments WHERE store_id=$1 AND id=$2 AND status='open' FOR UPDATE`, [auth.storeId, id]);
      if (!head.rowCount) throw new DomainError(404, 'CONSIGNMENT_NOT_FOUND', 'Condicional aberto não encontrado');
      const lines = await client.query<{ variant_id: string; quantity: number }>(`SELECT variant_id::text,quantity FROM retail_consignment_lines
        WHERE store_id=$1 AND consignment_id=$2 ORDER BY variant_id`, [auth.storeId, id]);
      const kept = new Map(request.body.lines.map(l => [l.variant_id.toLowerCase(), l.kept_quantity]));
      for (const key of kept.keys()) if (!lines.rows.some(l => l.variant_id.toLowerCase() === key))
        throw new DomainError(422, 'LINE_MISMATCH', 'Essa peça não está neste condicional.');
      const toCart: Array<{ variant_id: string; quantity: number }> = [];
      for (const line of lines.rows) {
        const keep = kept.get(line.variant_id.toLowerCase()) ?? 0;
        if (keep > line.quantity) throw new DomainError(422, 'KEPT_TOO_MANY', 'A cliente não pode ficar com mais peças do que levou.');
        // Libera tudo: as peças devolvidas voltam para a venda e as que ficaram vão para o carrinho do caixa.
        const b = await client.query<{ revision: string }>(`UPDATE stock_balances SET reserved=reserved-$3,revision=revision+1
          WHERE store_id=$1 AND variant_id=$2 AND reserved>=$3 RETURNING revision::text`, [auth.storeId, line.variant_id, line.quantity]);
        if (!b.rowCount) throw new DomainError(409, 'INCONSISTENT_STOCK', 'Saldo reservado inconsistente');
        await stockChanged(client, auth.storeId, line.variant_id, b.rows[0].revision, { consignment_id: id, reserved_delta: -line.quantity });
        await client.query(`UPDATE retail_consignment_lines SET kept_quantity=$4 WHERE store_id=$1 AND consignment_id=$2 AND variant_id=$3`,
          [auth.storeId, id, line.variant_id, keep]);
        if (keep) toCart.push({ variant_id: line.variant_id, quantity: keep });
      }
      await client.query(`UPDATE retail_consignments SET status='closed',closed_at=now(),closed_by=$3 WHERE store_id=$1 AND id=$2`, [auth.storeId, id, auth.userId]);
      await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail) VALUES($1,$2,'consignment.close',$3,$4::jsonb)`,
        [auth.storeId, auth.userId, id, JSON.stringify({ kept: toCart })]);
      return { id, closed: true, kept: toCart };
    });
    return out.result;
  });

  /* ---------- Promoções ---------- */
  app.get('/v1/promotions', async (request, reply) => {
    if (requirePermission(request, reply, 'catalog.read')) return reply;
    const q = await db.query(`SELECT id::text,name,kind,category,percent_bps,buy_quantity,pay_quantity,
       to_char(starts_on,'YYYY-MM-DD') AS starts_on,to_char(ends_on,'YYYY-MM-DD') AS ends_on,active,
       (active AND current_date BETWEEN starts_on AND ends_on) AS running
      FROM retail_promotions WHERE store_id=$1 ORDER BY active DESC,ends_on DESC,created_at DESC LIMIT 100`, [request.authContext!.storeId]);
    return { items: q.rows };
  });
  type PromoBody = { name: string; kind: 'percent' | 'buy_x_pay_y'; category?: string | null; percent_bps?: number;
    buy_quantity?: number; pay_quantity?: number; starts_on: string; ends_on: string };
  app.post<{ Body: PromoBody }>('/v1/promotions', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['name', 'kind', 'starts_on', 'ends_on'], properties: {
      name: { type: 'string', minLength: 3, maxLength: 80 }, kind: { type: 'string', enum: ['percent', 'buy_x_pay_y'] },
      category: { type: ['string', 'null'], maxLength: 80 }, percent_bps: { type: 'integer', minimum: 1, maximum: 9000 },
      buy_quantity: { type: 'integer', minimum: 2, maximum: 20 }, pay_quantity: { type: 'integer', minimum: 1, maximum: 19 },
      starts_on: date, ends_on: date } } },
  }, async (request, reply) => {
    if (requirePermission(request, reply, 'promotion.manage')) return reply;
    const auth = request.authContext!, b = request.body;
    validDate(b.starts_on, 'Data de início'); validDate(b.ends_on, 'Data de fim');
    if (b.ends_on < b.starts_on) throw new DomainError(422, 'BAD_PERIOD', 'A promoção precisa terminar depois de começar.');
    if (b.kind === 'percent' && !b.percent_bps) throw new DomainError(422, 'BAD_PERCENT', 'Informe o percentual da promoção.');
    if (b.kind === 'buy_x_pay_y' && (!b.buy_quantity || !b.pay_quantity || b.pay_quantity >= b.buy_quantity))
      throw new DomainError(422, 'BAD_BUY_PAY', 'Em "leve X pague Y", o Y precisa ser menor que o X.');
    const row = { name: b.name.trim(), kind: b.kind, category: b.category?.trim() || null,
      percent_bps: b.kind === 'percent' ? b.percent_bps! : null,
      buy_quantity: b.kind === 'buy_x_pay_y' ? b.buy_quantity! : null, pay_quantity: b.kind === 'buy_x_pay_y' ? b.pay_quantity! : null,
      starts_on: b.starts_on, ends_on: b.ends_on };
    const out = await withIdempotentTransaction(db, auth, 'promotion.create', requireIdempotencyKey(request.headers['idempotency-key']), row, async client => {
      const q = await client.query<{ id: string }>(`INSERT INTO retail_promotions(store_id,name,kind,category,percent_bps,buy_quantity,pay_quantity,starts_on,ends_on,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id::text`, [auth.storeId, row.name, row.kind, row.category, row.percent_bps,
        row.buy_quantity, row.pay_quantity, row.starts_on, row.ends_on, auth.userId]);
      await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail) VALUES($1,$2,'promotion.create',$3,$4::jsonb)`,
        [auth.storeId, auth.userId, q.rows[0].id, JSON.stringify(row)]);
      return { id: q.rows[0].id, ...row, active: true };
    });
    return reply.code(out.replayed ? 200 : 201).send(out.result);
  });
  app.post<{ Params: { id: string } }>('/v1/promotions/:id/end', {
    schema: { params: { type: 'object', required: ['id'], properties: { id: uuid } } },
  }, async (request, reply) => {
    if (requirePermission(request, reply, 'promotion.manage')) return reply;
    const auth = request.authContext!;
    const out = await withIdempotentTransaction(db, auth, 'promotion.end:' + request.params.id, requireIdempotencyKey(request.headers['idempotency-key']), {}, async client => {
      const q = await client.query(`UPDATE retail_promotions SET active=false WHERE store_id=$1 AND id=$2 AND active RETURNING id`, [auth.storeId, request.params.id]);
      if (!q.rowCount) throw new DomainError(404, 'PROMOTION_NOT_FOUND', 'Promoção ativa não encontrada');
      await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id) VALUES($1,$2,'promotion.end',$3)`, [auth.storeId, auth.userId, request.params.id]);
      return { id: request.params.id, active: false };
    });
    return out.result;
  });

  /* ---------- Relatórios de moda ---------- */
  app.get<{ Querystring: { days?: number; stale_days?: number } }>('/v1/reports/fashion', {
    schema: { querystring: { type: 'object', additionalProperties: false, properties: {
      days: { type: 'integer', minimum: 7, maximum: 365 }, stale_days: { type: 'integer', minimum: 15, maximum: 365 } } } },
  }, async (request, reply) => {
    if (requirePermission(request, reply, 'reports.read')) return reply;
    const storeId = request.authContext!.storeId, days = request.query.days ?? 90, staleDays = request.query.stale_days ?? 60;
    const sold = await db.query<{ product_id: string; name: string; category: string; units: string; revenue: string }>(`SELECT p.id::text AS product_id,p.name,p.category,
       sum(l.quantity)::text AS units,sum(l.line_total_cents)::text AS revenue
      FROM sale_lines l JOIN sales s ON s.id=l.sale_id AND s.store_id=l.store_id
      JOIN product_variants v ON v.id=l.variant_id AND v.store_id=l.store_id JOIN products p ON p.id=v.product_id AND p.store_id=v.store_id
      WHERE l.store_id=$1 AND s.created_at>=now()-make_interval(days=>$2::int)
      GROUP BY p.id,p.name,p.category ORDER BY sum(l.line_total_cents) DESC,p.name LIMIT 500`, [storeId, days]);
    const total = sold.rows.reduce((n, r) => n + Number(r.revenue), 0);
    let running = 0;
    const abc = sold.rows.map(r => {
      const revenue = Number(r.revenue), before = running;
      running += revenue;
      const share = total ? revenue / total : 0;
      // A: produtos que somam os primeiros 80% do faturamento; B: até 95%; C: o resto.
      const klass = total && before / total < 0.8 ? 'A' : total && before / total < 0.95 ? 'B' : 'C';
      return { product_id: r.product_id, name: r.name, category: r.category, units: Number(r.units), revenue_cents: revenue,
        share_bps: Math.round(share * 10000), class: klass };
    });
    const stale = await db.query<{ variant_id: string; sku: string; name: string; color: string; size: string; on_hand: string; last_sale: Date | null; received: Date | null }>(`SELECT v.id::text AS variant_id,v.sku,p.name,v.color,v.size,b.on_hand::text,
       (SELECT max(s.created_at) FROM sale_lines l JOIN sales s ON s.id=l.sale_id AND s.store_id=l.store_id WHERE l.store_id=v.store_id AND l.variant_id=v.id) AS last_sale,
       (SELECT min(m.occurred_at) FROM stock_movements m WHERE m.store_id=v.store_id AND m.variant_id=v.id AND m.qty_delta>0) AS received
      FROM product_variants v JOIN products p ON p.id=v.product_id AND p.store_id=v.store_id
      JOIN stock_balances b ON b.variant_id=v.id AND b.store_id=v.store_id
      WHERE v.store_id=$1 AND b.on_hand>0`, [storeId]);
    const cutoff = Date.now() - staleDays * 86400000;
    const staleItems = stale.rows.filter(r => {
      const ref = r.last_sale ?? r.received;
      return ref !== null && ref.getTime() < cutoff;
    }).map(r => {
      const ref = (r.last_sale ?? r.received)!;
      return { variant_id: r.variant_id, sku: r.sku, name: r.name, color: r.color, size: r.size, on_hand: Number(r.on_hand),
        last_sale_at: r.last_sale, days_without_sale: Math.floor((Date.now() - ref.getTime()) / 86400000) };
    }).sort((a, b) => b.days_without_sale - a.days_without_sale).slice(0, 200);
    const turnover = async (column: 'size' | 'color') => {
      const q = await db.query<{ value: string; sold: string; on_hand: string }>(`SELECT v.${column} AS value,
         coalesce(sum(x.units),0)::text AS sold,coalesce(sum(b.on_hand),0)::text AS on_hand
        FROM product_variants v LEFT JOIN stock_balances b ON b.variant_id=v.id AND b.store_id=v.store_id
        LEFT JOIN (SELECT l.variant_id,sum(l.quantity) AS units FROM sale_lines l JOIN sales s ON s.id=l.sale_id AND s.store_id=l.store_id
          WHERE l.store_id=$1 AND s.created_at>=now()-make_interval(days=>$2::int) GROUP BY l.variant_id) x ON x.variant_id=v.id
        WHERE v.store_id=$1 GROUP BY v.${column} HAVING coalesce(sum(x.units),0)+coalesce(sum(b.on_hand),0)>0
        ORDER BY coalesce(sum(x.units),0) DESC, v.${column} LIMIT 60`, [storeId, days]);
      return q.rows.map(r => { const s = Number(r.sold), o = Number(r.on_hand);
        return { value: r.value, sold: s, on_hand: o, sell_through_bps: s + o ? Math.round(s * 10000 / (s + o)) : 0 }; });
    };
    return { days, stale_days: staleDays, total_revenue_cents: total, abc, stale: staleItems, by_size: await turnover('size'), by_color: await turnover('color') };
  });

  /* ---------- Aniversariantes ---------- */
  app.get<{ Querystring: { month?: number } }>('/v1/customers/birthdays', {
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { month: { type: 'integer', minimum: 1, maximum: 12 } } } },
  }, async (request, reply) => {
    if (requirePermission(request, reply, 'customer.read')) return reply;
    const month = request.query.month ?? (new Date().getMonth() + 1);
    const q = await db.query(`SELECT id::text,name,phone,marketing_consent,extract(day FROM birth_date)::int AS day,
       to_char(birth_date,'YYYY-MM-DD') AS birth_date
      FROM retail_customers WHERE store_id=$1 AND anonymized_at IS NULL AND birth_date IS NOT NULL AND extract(month FROM birth_date)=$2
      ORDER BY extract(day FROM birth_date),lower(name) LIMIT 500`, [request.authContext!.storeId, month]);
    return { month, items: q.rows };
  });
}
