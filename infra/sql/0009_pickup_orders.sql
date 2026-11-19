ALTER TABLE stores ADD COLUMN pickup_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE pickup_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  submission_key uuid NOT NULL,
  fingerprint text NOT NULL,
  quoted_total_cents bigint NOT NULL CHECK (quoted_total_cents >= 0),
  sale_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, store_id),
  UNIQUE (store_id, submission_key),
  UNIQUE (store_id, sale_id),
  FOREIGN KEY (sale_id, store_id) REFERENCES sales(id, store_id)
);
CREATE INDEX pickup_orders_by_date ON pickup_orders(store_id, created_at DESC);

CREATE TABLE pickup_order_lines (
  order_id uuid NOT NULL,
  store_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  PRIMARY KEY (order_id, variant_id),
  FOREIGN KEY (order_id, store_id) REFERENCES pickup_orders(id, store_id),
  FOREIGN KEY (variant_id, store_id) REFERENCES product_variants(id, store_id)
);
