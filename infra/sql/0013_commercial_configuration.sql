ALTER TABLE purchase_orders ADD COLUMN promised_on date;
ALTER TABLE purchase_orders ADD COLUMN accepted_quantity integer;
ALTER TABLE purchase_orders ADD CHECK (accepted_quantity IS NULL OR (
  received_at IS NOT NULL AND accepted_quantity BETWEEN 0 AND quantity
));

CREATE TABLE product_field_definitions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id,id)
);
CREATE UNIQUE INDEX product_fields_label_by_store ON product_field_definitions(store_id,lower(label));
CREATE TABLE product_field_values (
  store_id uuid NOT NULL,
  product_id uuid NOT NULL,
  field_id uuid NOT NULL,
  value text NOT NULL CHECK (length(trim(value)) BETWEEN 1 AND 240),
  PRIMARY KEY (store_id,product_id,field_id),
  FOREIGN KEY (product_id,store_id) REFERENCES products(id,store_id),
  FOREIGN KEY (store_id,field_id) REFERENCES product_field_definitions(store_id,id)
);
