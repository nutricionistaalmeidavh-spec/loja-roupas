-- P1: tenant-isolated local management, without an external billing or CRM dependency.
CREATE TABLE IF NOT EXISTS operating_expenses(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES stores(id),
 created_by uuid NOT NULL REFERENCES users(id),
 category text NOT NULL CHECK(length(trim(category)) BETWEEN 1 AND 80),
 description text NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 240),
 amount_cents bigint NOT NULL CHECK(amount_cents>0 AND amount_cents<=9999999999),
 occurred_on date NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(store_id,id)
);
CREATE INDEX IF NOT EXISTS expenses_store_date_idx ON operating_expenses(store_id,occurred_on DESC,id);

CREATE TABLE IF NOT EXISTS retail_customers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES stores(id),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 120),
 phone text CHECK(phone IS NULL OR phone ~ '^\\+?[0-9]{10,15}$'),
 email text CHECK(email IS NULL OR length(email)<=254),
 marketing_consent boolean NOT NULL DEFAULT false,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 anonymized_at timestamptz,
 UNIQUE(store_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_phone_store_idx ON retail_customers(store_id,phone)
 WHERE phone IS NOT NULL AND anonymized_at IS NULL;
CREATE INDEX IF NOT EXISTS customer_name_store_idx ON retail_customers(store_id,lower(name),id);
