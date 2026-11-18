-- EP-02: esquema inicial mínimo. Não habilita checkout sem autenticação e transação.
BEGIN;
CREATE TABLE stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) >= 1),
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_store_roles (
  user_id uuid NOT NULL REFERENCES users(id),
  store_id uuid NOT NULL REFERENCES stores(id),
  role_code text NOT NULL,
  PRIMARY KEY (user_id, store_id, role_code)
);
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  name text NOT NULL CHECK(length(trim(name))>0),
  category text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  product_id uuid NOT NULL REFERENCES products(id),
  sku text NOT NULL,
  barcode text,
  color text NOT NULL,
  size text NOT NULL,
  price_cents bigint NOT NULL CHECK(price_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id, sku),
  UNIQUE(product_id, color, size)
);
CREATE UNIQUE INDEX product_variants_barcode_unique ON product_variants(store_id, barcode) WHERE barcode IS NOT NULL;
CREATE TABLE stock_balances (
  store_id uuid NOT NULL REFERENCES stores(id),
  variant_id uuid NOT NULL REFERENCES product_variants(id),
  on_hand bigint NOT NULL DEFAULT 0 CHECK(on_hand>=0),
  reserved bigint NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=on_hand),
  revision bigint NOT NULL DEFAULT 0,
  PRIMARY KEY(store_id, variant_id)
);
CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  variant_id uuid NOT NULL REFERENCES product_variants(id),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  movement_kind text NOT NULL,
  qty_delta bigint NOT NULL CHECK(qty_delta<>0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id, source_type, source_id, variant_id, movement_kind)
);
CREATE TABLE idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  scope text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  response_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id, scope, key)
);
CREATE TABLE outbox_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  event_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_revision bigint NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX outbox_pending ON outbox_events(occurred_at) WHERE delivered_at IS NULL;
COMMIT;
