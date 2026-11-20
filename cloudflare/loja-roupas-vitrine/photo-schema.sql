CREATE TABLE IF NOT EXISTS public_photos(
 tenant_id TEXT NOT NULL, product_id TEXT NOT NULL,content_base64 TEXT NOT NULL,
 sha256 TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,product_id),
 FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);
