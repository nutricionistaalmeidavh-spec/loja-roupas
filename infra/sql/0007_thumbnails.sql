-- M2: miniaturas otimizadas WebP self-hosted.
ALTER TABLE product_photos ADD COLUMN thumb_bytes bytea;
ALTER TABLE product_photos ADD COLUMN thumb_type text CHECK(thumb_type='image/webp');
ALTER TABLE product_photos ADD CONSTRAINT thumb_max_512k
 CHECK(thumb_bytes IS NULL OR octet_length(thumb_bytes) BETWEEN 16 AND 524288);
