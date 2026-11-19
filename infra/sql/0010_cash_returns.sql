ALTER TABLE cash_movements DROP CONSTRAINT cash_movements_kind_check;
ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_kind_check CHECK (kind IN ('supply','withdrawal','refund'));

CREATE TABLE cash_sale_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  cash_session_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 8 AND 250),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, sale_id),
  FOREIGN KEY (sale_id, store_id) REFERENCES sales(id, store_id),
  FOREIGN KEY (cash_session_id, store_id) REFERENCES cash_sessions(id, store_id)
);
CREATE INDEX cash_sale_returns_reporting ON cash_sale_returns (store_id, created_at DESC);
