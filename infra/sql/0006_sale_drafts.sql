-- M3: carrinhos suspensos não reservam estoque nem confirmam pagamentos.
CREATE TABLE suspended_sale_drafts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES stores(id),
 cash_session_id uuid NOT NULL,
 cashier_id uuid NOT NULL REFERENCES users(id),
 lines jsonb NOT NULL CHECK (jsonb_typeof(lines)='array'),
 note text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'suspended' CHECK(status IN('suspended','resumed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 resumed_at timestamptz,
 FOREIGN KEY(cash_session_id,store_id) REFERENCES cash_sessions(id,store_id)
);
CREATE INDEX suspended_sale_drafts_active ON suspended_sale_drafts(store_id,created_at DESC)
 WHERE status='suspended';
