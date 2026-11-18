-- M2: registro imutável lógico das mutações comerciais.
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  aggregate_id uuid NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_store_time ON audit_logs(store_id, occurred_at DESC);
