-- M3: núcleo transacional do caixa e do PDV. Recibos são estritamente NÃO fiscais.
CREATE TABLE cash_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES stores(id),
 terminal_code text NOT NULL CHECK(terminal_code ~ '^[A-Z0-9-]{3,32}$'),
 opened_by uuid NOT NULL REFERENCES users(id),
 opening_cents bigint NOT NULL CHECK(opening_cents >= 0),
 opened_at timestamptz NOT NULL DEFAULT now(),
 closed_at timestamptz,
 closed_by uuid REFERENCES users(id),
 expected_cash_cents bigint,
 counted_cash_cents bigint,
 difference_cents bigint,
 UNIQUE(id,store_id),
 CHECK((closed_at IS NULL AND closed_by IS NULL) OR closed_at IS NOT NULL)
);
CREATE UNIQUE INDEX cash_one_open_terminal ON cash_sessions(store_id,terminal_code) WHERE closed_at IS NULL;
CREATE TABLE cash_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL,
 cash_session_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('supply','withdrawal')),
 amount_cents bigint NOT NULL CHECK(amount_cents > 0),
 reason text NOT NULL CHECK(length(trim(reason)) >= 8),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(cash_session_id,store_id) REFERENCES cash_sessions(id,store_id)
);
CREATE TABLE store_counters (
 store_id uuid NOT NULL REFERENCES stores(id),
 counter_name text NOT NULL,
 last_number bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(store_id,counter_name)
);
CREATE TABLE sales (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES stores(id),
 sale_number bigint NOT NULL,
 cash_session_id uuid NOT NULL,
 cashier_id uuid NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled','returned','partially_returned')),
 total_cents bigint NOT NULL CHECK(total_cents >= 0),
 tendered_cents bigint NOT NULL CHECK(tendered_cents >= total_cents),
 change_cents bigint NOT NULL CHECK(change_cents >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,store_id),UNIQUE(store_id,sale_number),
 FOREIGN KEY(cash_session_id,store_id) REFERENCES cash_sessions(id,store_id)
);
CREATE TABLE sale_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sale_id uuid NOT NULL,
 store_id uuid NOT NULL,
 variant_id uuid NOT NULL,
 product_name text NOT NULL,
 sku text NOT NULL,
 color text NOT NULL,
 size text NOT NULL,
 quantity bigint NOT NULL CHECK(quantity > 0),
 unit_price_cents bigint NOT NULL CHECK(unit_price_cents >= 0),
 line_total_cents bigint NOT NULL CHECK(line_total_cents >= 0),
 FOREIGN KEY(sale_id,store_id) REFERENCES sales(id,store_id),
 FOREIGN KEY(variant_id,store_id) REFERENCES product_variants(id,store_id)
);
CREATE INDEX sale_lines_by_sale ON sale_lines(store_id,sale_id);
CREATE TABLE sale_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sale_id uuid NOT NULL,
 store_id uuid NOT NULL,
 method text NOT NULL CHECK(method IN ('cash','pix_manual','card_external')),
 amount_cents bigint NOT NULL CHECK(amount_cents > 0),
 external_reference text,
 confirmed_manually boolean NOT NULL DEFAULT true,
 FOREIGN KEY(sale_id,store_id) REFERENCES sales(id,store_id)
);
CREATE UNIQUE INDEX external_payment_reference ON sale_payments(store_id,method,external_reference)
 WHERE method IN ('pix_manual','card_external') AND external_reference IS NOT NULL;
