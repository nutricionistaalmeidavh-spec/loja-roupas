-- M2: versões de catálogo e mídia self-hosted no PostgreSQL. Backups incluem fotos.
ALTER TABLE products ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE product_variants ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0);
CREATE TABLE product_photos (
  product_id uuid NOT NULL,
  store_id uuid NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('image/png','image/jpeg','image/webp')),
  image_bytes bytea NOT NULL CHECK (octet_length(image_bytes) BETWEEN 16 AND 2097152),
  sha256 char(64) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(product_id,store_id),
  FOREIGN KEY(product_id,store_id) REFERENCES products(id,store_id) ON DELETE CASCADE
);
