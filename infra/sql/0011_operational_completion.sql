ALTER TABLE receipt_print_requests ADD COLUMN completed_at timestamptz;
ALTER TABLE receipt_print_requests ADD COLUMN completed_by uuid REFERENCES users(id);
ALTER TABLE receipt_print_requests ADD CHECK ((completed_at IS NULL) = (completed_by IS NULL));
CREATE INDEX receipt_print_pending ON receipt_print_requests(store_id,created_at,id) WHERE completed_at IS NULL;

ALTER TABLE suppliers ADD UNIQUE (id,store_id);
CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 100000),
  unit_cost_cents bigint NOT NULL CHECK (unit_cost_cents BETWEEN 0 AND 100000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz,
  FOREIGN KEY (supplier_id,store_id) REFERENCES suppliers(id,store_id),
  FOREIGN KEY (variant_id,store_id) REFERENCES product_variants(id,store_id)
);
CREATE INDEX purchase_orders_by_store ON purchase_orders(store_id,created_at DESC,id);

ALTER TABLE pickup_orders ADD COLUMN cancelled_at timestamptz;
ALTER TABLE pickup_orders ADD CHECK (cancelled_at IS NULL OR sale_id IS NULL);
