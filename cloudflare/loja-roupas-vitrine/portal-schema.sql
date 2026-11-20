-- Aditivo: login restrito dos proprietários das lojas cadastradas pela ArtiSys.
CREATE TABLE IF NOT EXISTS tenant_owners(
 tenant_id TEXT PRIMARY KEY NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 email_normalized TEXT NOT NULL,
 password_salt TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tenant_sessions(
 digest TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 issued_at TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_portal_sessions_tenant ON tenant_sessions(tenant_id,expires_at);
CREATE TABLE IF NOT EXISTS portal_login_attempts(
 digest TEXT PRIMARY KEY,
 attempts INTEGER NOT NULL DEFAULT 0,
 last_at TEXT NOT NULL
);
