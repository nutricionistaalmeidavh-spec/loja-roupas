-- Correções de regras de negócio da avaliação de 27/11/2026. Apenas acréscimos: não reescreve histórico.

-- Perfil da loja (comprovante) e limite de desconto do caixa.
ALTER TABLE stores
  ADD COLUMN legal_name text CHECK (legal_name IS NULL OR length(trim(legal_name)) BETWEEN 2 AND 160),
  ADD COLUMN document text CHECK (document IS NULL OR length(trim(document)) BETWEEN 5 AND 32),
  ADD COLUMN address text CHECK (address IS NULL OR length(trim(address)) BETWEEN 5 AND 240),
  ADD COLUMN phone text CHECK (phone IS NULL OR length(trim(phone)) BETWEEN 8 AND 32),
  ADD COLUMN receipt_footer text CHECK (receipt_footer IS NULL OR length(receipt_footer) <= 240),
  ADD COLUMN max_cashier_discount_bps integer NOT NULL DEFAULT 1000
    CHECK (max_cashier_discount_bps BETWEEN 0 AND 10000);

-- Usuários: nome de exibição.
ALTER TABLE users ADD COLUMN display_name text CHECK (display_name IS NULL OR length(trim(display_name)) BETWEEN 2 AND 120);

-- Desconto na venda. line_total_cents passa a ser o valor líquido pago pela linha.
ALTER TABLE sale_lines ADD COLUMN discount_cents bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0);
ALTER TABLE sales
  ADD COLUMN subtotal_cents bigint CHECK (subtotal_cents >= 0),
  ADD COLUMN discount_cents bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  ADD COLUMN discount_reason text CHECK (discount_reason IS NULL OR length(trim(discount_reason)) BETWEEN 3 AND 160),
  ADD COLUMN discount_by uuid REFERENCES users(id);
UPDATE sales SET subtotal_cents = total_cents WHERE subtotal_cents IS NULL;

-- Custo da peça quando não há compra conferida.
ALTER TABLE product_variants ADD COLUMN cost_cents bigint CHECK (cost_cents >= 0);

-- Peças avariadas ficam separadas do saldo vendável.
ALTER TABLE stock_balances ADD COLUMN quarantined bigint NOT NULL DEFAULT 0 CHECK (quarantined >= 0);
CREATE TABLE stock_quarantine_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  variant_id uuid NOT NULL,
  qty_delta bigint NOT NULL CHECK (qty_delta <> 0),
  kind text NOT NULL CHECK (kind IN ('return','release','discard')),
  source_id uuid,
  reason text,
  actor_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (variant_id, store_id) REFERENCES product_variants(id, store_id)
);
CREATE INDEX stock_quarantine_moves_variant ON stock_quarantine_moves(store_id, variant_id, created_at);

-- Devolução unificada: reparte o reembolso entre os meios originais.
ALTER TABLE retail_after_sales DROP CONSTRAINT retail_after_sales_kind_check;
ALTER TABLE retail_after_sales ADD CONSTRAINT retail_after_sales_kind_check
  CHECK (kind IN ('external_refund','exchange','refund'));
ALTER TABLE retail_after_sales DROP CONSTRAINT retail_after_sales_check;
ALTER TABLE retail_after_sales ADD CONSTRAINT retail_after_sales_check CHECK (
  (kind = 'external_refund' AND payment_method IN ('pix_manual','card_external') AND length(trim(external_reference)) >= 6)
  OR (kind IN ('exchange','refund') AND payment_method IS NULL AND external_reference IS NULL));
ALTER TABLE retail_after_sales ADD COLUMN cash_session_id uuid;
CREATE TABLE retail_refund_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  method text NOT NULL CHECK (method IN ('cash','pix_manual','card_external','store_credit','customer_credit')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  external_reference text,
  cash_session_id uuid,
  FOREIGN KEY (operation_id, store_id) REFERENCES retail_after_sales(id, store_id),
  FOREIGN KEY (cash_session_id, store_id) REFERENCES cash_sessions(id, store_id),
  CHECK ((method = 'cash') = (cash_session_id IS NOT NULL)),
  CHECK (method NOT IN ('pix_manual','card_external') OR length(trim(external_reference)) >= 4)
);
CREATE INDEX retail_refund_parts_operation ON retail_refund_parts(store_id, operation_id);

-- Referência de Pix/cartão: códigos de autorização se repetem; deixa de ser única.
DROP INDEX external_payment_reference;
CREATE INDEX sale_payments_external_reference ON sale_payments(store_id, method, external_reference)
  WHERE external_reference IS NOT NULL;

-- Reservas com validade e pedido de retirada que segura a peça.
ALTER TABLE stock_holds ADD COLUMN expires_at timestamptz;
UPDATE stock_holds SET expires_at = created_at + interval '24 hours' WHERE expires_at IS NULL;
ALTER TABLE stock_holds ALTER COLUMN expires_at SET NOT NULL;
ALTER TABLE stock_holds ALTER COLUMN expires_at SET DEFAULT now() + interval '24 hours';
ALTER TABLE stock_holds ADD COLUMN release_reason text;
CREATE INDEX stock_holds_active ON stock_holds(store_id, expires_at) WHERE released_at IS NULL;
ALTER TABLE pickup_orders ADD COLUMN reservation_released_at timestamptz;
-- Pedidos anteriores não reservaram estoque.
UPDATE pickup_orders SET reservation_released_at = now() WHERE reservation_released_at IS NULL;

-- Despesas corrigíveis: estorno lógico em vez de exclusão física.
ALTER TABLE operating_expenses
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN voided_by uuid REFERENCES users(id),
  ADD COLUMN void_reason text,
  ADD COLUMN updated_at timestamptz;
CREATE INDEX operating_expenses_month ON operating_expenses(store_id, occurred_on) WHERE voided_at IS NULL;

-- Compras: agrupamento de grade e conta a pagar da mercadoria.
ALTER TABLE purchase_orders ADD COLUMN batch_id uuid;
CREATE INDEX purchase_orders_batch ON purchase_orders(store_id, batch_id) WHERE batch_id IS NOT NULL;

-- Receita líquida canônica: toda tela de faturamento lê desta visão.
CREATE VIEW retail_revenue_events AS
  SELECT s.store_id, s.created_at AS occurred_at, s.total_cents AS gross_cents, 0::bigint AS refund_cents,
         1 AS sale_count, 'sale'::text AS source
    FROM sales s WHERE s.status <> 'cancelled'
  UNION ALL
  SELECT r.store_id, r.created_at, 0, r.amount_cents, 0, 'cash_return' FROM cash_sale_returns r
  UNION ALL
  SELECT a.store_id, a.created_at, 0, a.amount_cents, 0, a.kind FROM retail_after_sales a;

-- Clientes: busca por nome/telefone.
CREATE INDEX retail_customers_name_search ON retail_customers(store_id, lower(name)) WHERE anonymized_at IS NULL;
