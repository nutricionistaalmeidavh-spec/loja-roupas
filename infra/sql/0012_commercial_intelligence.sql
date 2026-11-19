CREATE TABLE commercial_preferences (
  store_id uuid PRIMARY KEY REFERENCES stores(id),
  target_cents bigint NOT NULL CHECK (target_cents BETWEEN 0 AND 9999999999),
  low_stock_limit integer NOT NULL CHECK (low_stock_limit BETWEEN 0 AND 999),
  widgets text[] NOT NULL CHECK (widgets <@ ARRAY['seasonality','collections','suppliers','stock']::text[])
);
ALTER TABLE products ADD COLUMN collection_name text CHECK (length(collection_name) BETWEEN 1 AND 80);
CREATE INDEX sales_by_store_date ON sales (store_id,created_at);
