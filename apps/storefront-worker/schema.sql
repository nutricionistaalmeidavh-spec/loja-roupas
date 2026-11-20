-- Vitrine multitenant: isolada do PostgreSQL canônico de cada loja.
-- Banco D1 é opcional; PDV local não depende deste serviço.
CREATE TABLE IF NOT EXISTS tenants (
 id TEXT PRIMARY KEY,
 license_id TEXT NOT NULL UNIQUE,
 local_store_id TEXT NOT NULL,
 installation_id TEXT NOT NULL,
 slug TEXT NOT NULL UNIQUE,
 display_name TEXT NOT NULL,
 sync_secret_hash TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 last_sync_at TEXT,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tenants_installation ON tenants(installation_id);
CREATE TABLE IF NOT EXISTS catalog_variants (
 tenant_id TEXT NOT NULL,
 variant_id TEXT NOT NULL,
 product_name TEXT NOT NULL,
 sku TEXT NOT NULL,
 color TEXT NOT NULL,
 size TEXT NOT NULL,
 category TEXT NOT NULL,
 price_cents INTEGER NOT NULL CHECK(price_cents>=0),
 available INTEGER NOT NULL CHECK(available>=0),
 published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,variant_id),
 FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS catalog_public ON catalog_variants(tenant_id,published,variant_id);
CREATE TABLE IF NOT EXISTS pickup_orders (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 request_key TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','fulfilled')),
 lines_json TEXT NOT NULL,
 quote_cents INTEGER NOT NULL CHECK(quote_cents>=0),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(tenant_id,request_key),
 FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS pickup_tenant_pending ON pickup_orders(tenant_id,status,created_at,id);
