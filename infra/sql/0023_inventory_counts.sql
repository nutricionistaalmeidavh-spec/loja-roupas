CREATE TABLE inventory_count_sessions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL REFERENCES stores(id),
 started_by uuid NOT NULL REFERENCES users(id),started_at timestamptz NOT NULL DEFAULT now(),
 closed_by uuid REFERENCES users(id),closed_at timestamptz,UNIQUE(store_id,id)
);
CREATE UNIQUE INDEX inventory_one_open_per_store ON inventory_count_sessions(store_id) WHERE closed_at IS NULL;
CREATE TABLE inventory_count_lines(
 store_id uuid NOT NULL REFERENCES stores(id),count_id uuid NOT NULL,variant_id uuid NOT NULL,
 expected_on_hand bigint NOT NULL CHECK(expected_on_hand>=0),
 counted_on_hand bigint NOT NULL CHECK(counted_on_hand>=0),
 counted_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(store_id,count_id,variant_id),
 FOREIGN KEY(store_id,count_id) REFERENCES inventory_count_sessions(store_id,id),
 FOREIGN KEY(variant_id,store_id) REFERENCES product_variants(id,store_id)
);
