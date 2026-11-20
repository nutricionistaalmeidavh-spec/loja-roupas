-- Integração opcional. O PostgreSQL segue como fonte canônica, sem dependência de Cloudflare.
CREATE TABLE marketplace_links (
 store_id uuid PRIMARY KEY REFERENCES stores(id),
 slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'),
 secret_encrypted text NOT NULL,
 enabled boolean NOT NULL DEFAULT true,
 last_attempt_at timestamptz,
 last_success_at timestamptz,
 last_error text,
 order_cursor uuid,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE marketplace_listings (
 store_id uuid NOT NULL REFERENCES stores(id),
 variant_id uuid NOT NULL,
 revision bigint NOT NULL CHECK (revision > 0),
 fingerprint char(64) NOT NULL,
 payload jsonb NOT NULL,
 delivered_revision bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(store_id,variant_id),
 FOREIGN KEY(variant_id,store_id) REFERENCES product_variants(id,store_id)
);
CREATE INDEX marketplace_listings_pending ON marketplace_listings(store_id,revision) WHERE delivered_revision < revision;
CREATE TABLE marketplace_photos (
 store_id uuid NOT NULL REFERENCES stores(id),
 product_id uuid NOT NULL,
 source_hash char(64) NOT NULL,
 PRIMARY KEY(store_id,product_id),
 FOREIGN KEY(product_id,store_id) REFERENCES products(id,store_id)
);
CREATE TABLE marketplace_orders (
 store_id uuid NOT NULL REFERENCES stores(id),
 remote_id uuid NOT NULL,
 request_id text NOT NULL,
 customer_name text NOT NULL,
 customer_phone text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
 remote_status text NOT NULL DEFAULT 'pending' CHECK(remote_status IN ('pending','accepted','rejected','fulfilled')),
 created_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(store_id,remote_id),
 UNIQUE(store_id,request_id)
);
CREATE TABLE marketplace_order_lines (
 store_id uuid NOT NULL,
 remote_id uuid NOT NULL,
 variant_id uuid NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 10),
 PRIMARY KEY(store_id,remote_id,variant_id),
 FOREIGN KEY(store_id,remote_id) REFERENCES marketplace_orders(store_id,remote_id),
 -- Produto descontinuado ainda precisa ser visível para recusa segura do pedido.
 CONSTRAINT marketplace_order_line_store CHECK (quantity > 0)
);
CREATE INDEX marketplace_orders_to_sync ON marketplace_orders(store_id,created_at) WHERE status<>remote_status;
