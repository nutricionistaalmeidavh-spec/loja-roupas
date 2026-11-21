-- P0/P1: concessões individuais para entrada direta; não altera saldos históricos.
CREATE TABLE stock_direct_receive_grants (
  store_id uuid NOT NULL REFERENCES stores(id),
  user_id uuid NOT NULL REFERENCES users(id),
  granted_by uuid NOT NULL REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY(store_id,user_id)
);
CREATE INDEX stock_direct_receive_grants_active ON stock_direct_receive_grants(store_id,user_id) WHERE revoked_at IS NULL;
