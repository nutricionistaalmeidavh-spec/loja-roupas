-- Condicional (malinha): a cliente leva peças para provar; o estoque fica reservado até a devolução.
CREATE TABLE IF NOT EXISTS retail_consignments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES stores(id),
 number bigint NOT NULL,
 customer_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 due_on date NOT NULL,
 note text CHECK(note IS NULL OR length(note)<=240),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 closed_by uuid REFERENCES users(id),
 closed_at timestamptz,
 UNIQUE(store_id,id),
 UNIQUE(store_id,number),
 FOREIGN KEY(store_id,customer_id) REFERENCES retail_customers(store_id,id),
 CHECK((status='open')=(closed_at IS NULL))
);
CREATE INDEX IF NOT EXISTS retail_consignments_open ON retail_consignments(store_id,due_on,id) WHERE status='open';
CREATE TABLE IF NOT EXISTS retail_consignment_lines(
 store_id uuid NOT NULL,
 consignment_id uuid NOT NULL,
 variant_id uuid NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 99),
 kept_quantity integer CHECK(kept_quantity IS NULL OR kept_quantity BETWEEN 0 AND quantity),
 PRIMARY KEY(consignment_id,variant_id),
 FOREIGN KEY(store_id,consignment_id) REFERENCES retail_consignments(store_id,id),
 FOREIGN KEY(variant_id,store_id) REFERENCES product_variants(id,store_id)
);

-- Promoções automáticas: % por categoria (ou loja toda) e "leve X pague Y".
CREATE TABLE IF NOT EXISTS retail_promotions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES stores(id),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 3 AND 80),
 kind text NOT NULL CHECK(kind IN ('percent','buy_x_pay_y')),
 category text CHECK(category IS NULL OR length(category) BETWEEN 1 AND 80),
 percent_bps integer CHECK(percent_bps IS NULL OR percent_bps BETWEEN 1 AND 9000),
 buy_quantity integer CHECK(buy_quantity IS NULL OR buy_quantity BETWEEN 2 AND 20),
 pay_quantity integer CHECK(pay_quantity IS NULL OR pay_quantity BETWEEN 1 AND 19),
 starts_on date NOT NULL,
 ends_on date NOT NULL,
 active boolean NOT NULL DEFAULT true,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_on>=starts_on),
 CHECK((kind='percent' AND percent_bps IS NOT NULL AND buy_quantity IS NULL AND pay_quantity IS NULL)
    OR (kind='buy_x_pay_y' AND percent_bps IS NULL AND buy_quantity IS NOT NULL AND pay_quantity IS NOT NULL AND pay_quantity<buy_quantity))
);
CREATE INDEX IF NOT EXISTS retail_promotions_active ON retail_promotions(store_id,starts_on,ends_on) WHERE active;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS promotion_cents bigint NOT NULL DEFAULT 0 CHECK(promotion_cents>=0);

-- Aniversário da cliente (dia e mês bastam; o ano é opcional) para a lista do mês com WhatsApp.
ALTER TABLE retail_customers ADD COLUMN IF NOT EXISTS birth_date date;
CREATE INDEX IF NOT EXISTS retail_customers_birth_month ON retail_customers(store_id,(extract(month FROM birth_date))) WHERE birth_date IS NOT NULL AND anonymized_at IS NULL;
