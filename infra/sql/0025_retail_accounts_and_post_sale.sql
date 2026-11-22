-- P1: ledger de contas, crédito, fidelidade e pós-venda. Apenas acréscimos: não reescrever histórico.
ALTER TABLE sales ADD COLUMN customer_id uuid;
ALTER TABLE sales ADD COLUMN seller_id uuid REFERENCES users(id);
ALTER TABLE sales ADD CONSTRAINT sales_customer_store_fk FOREIGN KEY(customer_id,store_id) REFERENCES retail_customers(id,store_id);
ALTER TABLE sale_lines ADD COLUMN cost_unit_cents bigint CHECK(cost_unit_cents>=0);
ALTER TABLE sale_payments DROP CONSTRAINT sale_payments_method_check;
ALTER TABLE sale_payments ADD CONSTRAINT sale_payments_method_check CHECK(method IN ('cash','pix_manual','card_external','store_credit','exchange_credit'));
ALTER TABLE cash_movements DROP CONSTRAINT cash_movements_kind_check;
ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_kind_check CHECK(kind IN ('supply','withdrawal','refund','credit_collection','exchange_collection'));

CREATE TABLE retail_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES stores(id), kind text NOT NULL CHECK(kind IN ('payable','receivable')),
 customer_id uuid, supplier_id uuid, source_type text NOT NULL DEFAULT 'manual',source_id uuid,
 description text NOT NULL CHECK(length(trim(description)) BETWEEN 3 AND 240),
 amount_cents bigint NOT NULL CHECK(amount_cents>0),
 settled_cents bigint NOT NULL DEFAULT 0 CHECK(settled_cents>=0),
 due_on date NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 cancelled_at timestamptz,
 UNIQUE(store_id,id),CHECK(settled_cents<=amount_cents),
 FOREIGN KEY(customer_id,store_id) REFERENCES retail_customers(id,store_id),
 FOREIGN KEY(supplier_id,store_id) REFERENCES suppliers(id,store_id)
);
CREATE INDEX retail_accounts_due_idx ON retail_accounts(store_id,kind,due_on,id) WHERE cancelled_at IS NULL;
CREATE INDEX retail_accounts_customer_idx ON retail_accounts(store_id,customer_id) WHERE kind='receivable';
CREATE TABLE retail_account_settlements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL,
 account_id uuid NOT NULL,amount_cents bigint NOT NULL CHECK(amount_cents>0),
 method text NOT NULL CHECK(method IN ('cash','pix_manual','card_external','bank_transfer')),
 external_reference text, cash_session_id uuid,
 actor_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(store_id,id),FOREIGN KEY(account_id,store_id) REFERENCES retail_accounts(id,store_id),
 FOREIGN KEY(cash_session_id,store_id) REFERENCES cash_sessions(id,store_id),
 CHECK ((method='cash' AND cash_session_id IS NOT NULL AND external_reference IS NULL)
  OR (method<>'cash' AND cash_session_id IS NULL AND length(trim(external_reference))>=6))
);
CREATE UNIQUE INDEX retail_account_external_ref ON retail_account_settlements(store_id,method,external_reference)
 WHERE method<>'cash';

CREATE TABLE retail_credit_limits (
 store_id uuid NOT NULL,customer_id uuid NOT NULL,credit_limit_cents bigint NOT NULL CHECK(credit_limit_cents BETWEEN 0 AND 9999999999),
 enabled boolean NOT NULL DEFAULT false,updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(store_id,customer_id),FOREIGN KEY(customer_id,store_id) REFERENCES retail_customers(id,store_id)
);
CREATE TABLE retail_customer_credits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL,customer_id uuid NOT NULL,
 source_type text NOT NULL,source_id uuid NOT NULL,amount_cents bigint NOT NULL CHECK(amount_cents>0),
 used_cents bigint NOT NULL DEFAULT 0 CHECK(used_cents>=0 AND used_cents<=amount_cents),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(store_id,id),
 UNIQUE(store_id,source_type,source_id),FOREIGN KEY(customer_id,store_id) REFERENCES retail_customers(id,store_id)
);

CREATE TABLE retail_commission_rules (
 store_id uuid NOT NULL REFERENCES stores(id),seller_id uuid NOT NULL REFERENCES users(id),
 rate_bps integer NOT NULL CHECK(rate_bps BETWEEN 0 AND 10000),
 updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(store_id,seller_id)
);
CREATE TABLE retail_commission_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL,sale_id uuid NOT NULL,
 seller_id uuid NOT NULL REFERENCES users(id),base_cents bigint NOT NULL CHECK(base_cents>=0),
 rate_bps integer NOT NULL CHECK(rate_bps BETWEEN 0 AND 10000),
 amount_cents bigint NOT NULL CHECK(amount_cents>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(store_id,sale_id),FOREIGN KEY(sale_id,store_id) REFERENCES sales(id,store_id)
);
CREATE INDEX retail_commissions_seller_idx ON retail_commission_entries(store_id,seller_id,created_at);

CREATE TABLE retail_loyalty_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL,customer_id uuid NOT NULL,
 sale_id uuid, points bigint NOT NULL CHECK(points<>0),kind text NOT NULL CHECK(kind IN ('earn','redeem','reverse')),
 note text NOT NULL DEFAULT '',actor_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(store_id,id),FOREIGN KEY(customer_id,store_id) REFERENCES retail_customers(id,store_id),
 FOREIGN KEY(sale_id,store_id) REFERENCES sales(id,store_id)
);
CREATE UNIQUE INDEX retail_loyalty_sale_earn ON retail_loyalty_events(store_id,sale_id)
 WHERE kind='earn' AND sale_id IS NOT NULL;
CREATE INDEX retail_loyalty_customer_idx ON retail_loyalty_events(store_id,customer_id,created_at);

CREATE TABLE retail_after_sales (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL,sale_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('external_refund','exchange')),
 actor_id uuid NOT NULL REFERENCES users(id),amount_cents bigint NOT NULL CHECK(amount_cents>=0),
 payment_method text,external_reference text,
 replacement_sale_id uuid,reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 8 AND 250),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(store_id,id),
 FOREIGN KEY(sale_id,store_id) REFERENCES sales(id,store_id),
 FOREIGN KEY(replacement_sale_id,store_id) REFERENCES sales(id,store_id),
 CHECK((kind='external_refund' AND payment_method IN ('pix_manual','card_external') AND length(trim(external_reference))>=6)
  OR (kind='exchange' AND payment_method IS NULL AND external_reference IS NULL))
);
CREATE UNIQUE INDEX retail_refund_external_reference ON retail_after_sales(store_id,payment_method,external_reference)
 WHERE kind='external_refund';
CREATE TABLE retail_after_sale_lines (
 store_id uuid NOT NULL,operation_id uuid NOT NULL,sale_line_id uuid NOT NULL REFERENCES sale_lines(id),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 10000),
 disposition text NOT NULL CHECK(disposition IN ('resellable','quarantine')),
 unit_amount_cents bigint NOT NULL CHECK(unit_amount_cents>=0),
 PRIMARY KEY(store_id,operation_id,sale_line_id),
 FOREIGN KEY(operation_id,store_id) REFERENCES retail_after_sales(id,store_id)
);
CREATE INDEX retail_after_sale_by_line ON retail_after_sale_lines(store_id,sale_line_id);

CREATE TABLE retail_operator_pins (
 store_id uuid NOT NULL REFERENCES stores(id),user_id uuid NOT NULL REFERENCES users(id),
 pin_hash text NOT NULL, failed_attempts integer NOT NULL DEFAULT 0 CHECK(failed_attempts BETWEEN 0 AND 10),
 locked_until timestamptz,updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(store_id,user_id)
);
ALTER TABLE inventory_count_lines ADD COLUMN approved_by uuid REFERENCES users(id);
ALTER TABLE inventory_count_lines ADD COLUMN approved_at timestamptz;
ALTER TABLE inventory_count_lines ADD CONSTRAINT inventory_count_approval_pair CHECK((approved_by IS NULL)=(approved_at IS NULL));
