-- P0/P1/P2: índices da busca e fotos adicionais, totalmente locais no PostgreSQL.
-- Não reescrever migrações antigas: o instalador valida checksums.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Filtro por substring (ILIKE '%texto%') e cursor estável (name,id) por loja.
CREATE INDEX catalog_products_name_trgm ON products USING GIN (name gin_trgm_ops);
CREATE INDEX catalog_variants_sku_trgm ON product_variants USING GIN (sku gin_trgm_ops);
CREATE INDEX catalog_products_store_name_seek ON products(store_id,name,id);
CREATE INDEX catalog_products_category_seek ON products(store_id,category,name,id);
CREATE INDEX catalog_variants_product_seek ON product_variants(store_id,product_id,sku,id);

-- Foto principal legada segue em product_photos. A galeria só guarda fotos adicionais,
-- preservando rotas e backups existentes, sem duplicar os bytes da foto principal.
CREATE TABLE product_gallery_photos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES stores(id),
 product_id uuid NOT NULL,
 variant_id uuid,
 content_type text NOT NULL CHECK(content_type IN ('image/png','image/jpeg','image/webp')),
 image_bytes bytea NOT NULL CHECK(octet_length(image_bytes) BETWEEN 16 AND 2097152),
 thumb_bytes bytea NOT NULL CHECK(octet_length(thumb_bytes) BETWEEN 16 AND 524288),
 sha256 char(64) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(product_id,store_id) REFERENCES products(id,store_id) ON DELETE CASCADE,
 FOREIGN KEY(variant_id,store_id) REFERENCES product_variants(id,store_id)
);
CREATE INDEX product_gallery_by_product ON product_gallery_photos(store_id,product_id,created_at,id);
CREATE INDEX product_gallery_by_variant ON product_gallery_photos(store_id,variant_id) WHERE variant_id IS NOT NULL;
