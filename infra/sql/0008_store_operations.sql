CREATE TABLE receipt_print_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  paper_mm smallint NOT NULL CHECK (paper_mm IN (58, 80)),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (sale_id, store_id) REFERENCES sales(id, store_id)
);
CREATE INDEX receipt_print_requests_by_sale ON receipt_print_requests(store_id, sale_id, created_at);

CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX suppliers_name_unique ON suppliers(store_id, lower(name));

ALTER TABLE product_variants ADD COLUMN storefront_published boolean NOT NULL DEFAULT false;
CREATE INDEX storefront_published_variants ON product_variants(store_id, id) WHERE storefront_published;

CREATE TABLE stock_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  FOREIGN KEY (variant_id, store_id) REFERENCES product_variants(id, store_id)
);
CREATE INDEX stock_holds_open ON stock_holds(store_id, created_at DESC, id) WHERE released_at IS NULL;
