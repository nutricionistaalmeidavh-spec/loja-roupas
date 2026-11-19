CREATE INDEX product_variants_scan_sku ON product_variants(store_id,upper(sku));
CREATE INDEX product_variants_scan_barcode ON product_variants(store_id,upper(barcode));
