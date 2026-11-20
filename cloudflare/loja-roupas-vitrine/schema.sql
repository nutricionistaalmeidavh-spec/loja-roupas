-- Vitrine online opcional. Banco operacional permanece no PostgreSQL local.
CREATE TABLE IF NOT EXISTS tenants(
 id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 installation_id TEXT NOT NULL UNIQUE, sync_hash TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS variants(
 tenant_id TEXT NOT NULL, id TEXT NOT NULL, product_id TEXT NOT NULL,
 name TEXT NOT NULL, category TEXT NOT NULL, color TEXT NOT NULL,
 size TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK(price_cents>=0),
 available INTEGER NOT NULL CHECK(available>=0), published INTEGER NOT NULL CHECK(published IN (0,1)),
 revision INTEGER NOT NULL CHECK(revision>=0), photo_url TEXT,
 updated_at TEXT NOT NULL, PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_variants_public ON variants(tenant_id,published,name,id);
CREATE TABLE IF NOT EXISTS pickup_orders(
 tenant_id TEXT NOT NULL, id TEXT NOT NULL, request_id TEXT NOT NULL,
 customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL DEFAULT '',
 lines_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected','fulfilled')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,request_id),
 FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_pickup_pending ON pickup_orders(tenant_id,status,created_at);
