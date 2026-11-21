-- P2: galeria adicional self-hosted. Preserva product_photos como foto principal
-- e todos os endpoints/consumidores anteriores.
CREATE TABLE product_gallery_photos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES stores(id),
 product_id uuid NOT NULL,
 variant_id uuid,
 position smallint NOT NULL CHECK (position BETWEEN 1 AND 7),
 content_type text NOT NULL CHECK (content_type IN ('image/png','image/jpeg','image/webp')),
 image_bytes bytea NOT NULL CHECK (octet_length(image_bytes) BETWEEN 16 AND 2097152),
 thumb_bytes bytea NOT NULL CHECK (octet_length(thumb_bytes) BETWEEN 16 AND 524288),
 sha256 char(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(store_id,product_id,position),
 FOREIGN KEY(product_id,store_id) REFERENCES products(id,store_id) ON DELETE CASCADE,
 FOREIGN KEY(variant_id,store_id) REFERENCES product_variants(id,store_id) ON DELETE CASCADE
);
