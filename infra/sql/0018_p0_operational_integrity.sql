-- P0: inspeção ANTES de disponibilizar estoque e devoluções parciais auditadas.
-- Não reclassificar saldos históricos automaticamente: exigem inventário/reconciliação.
ALTER TABLE purchase_orders
  ADD COLUMN received_quantity integer,
  ADD COLUMN rejected_quantity integer,
  ADD COLUMN missing_quantity integer,
  ADD COLUMN quality_finalized boolean NOT NULL DEFAULT false;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_checked_quantities CHECK (
  (NOT quality_finalized AND received_quantity IS NULL AND rejected_quantity IS NULL AND missing_quantity IS NULL)
  OR (quality_finalized AND received_at IS NOT NULL AND accepted_quantity IS NOT NULL
      AND received_quantity BETWEEN 1 AND quantity AND rejected_quantity >= 0 AND missing_quantity >= 0
      AND accepted_quantity + rejected_quantity = received_quantity
      AND received_quantity + missing_quantity = quantity)
);
-- Compras antigas continuam registradas como legadas, sem estorno automático de peças já vendidas.

ALTER TABLE cash_sale_returns DROP CONSTRAINT cash_sale_returns_store_id_sale_id_key;
ALTER TABLE cash_sale_returns ADD CONSTRAINT cash_sale_returns_id_store_unique UNIQUE (id,store_id);
CREATE INDEX cash_sale_returns_by_sale ON cash_sale_returns(store_id,sale_id,created_at);

CREATE TABLE cash_return_lines (
  store_id uuid NOT NULL,
  return_id uuid NOT NULL,
  sale_line_id uuid NOT NULL REFERENCES sale_lines(id),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  disposition text NOT NULL CHECK (disposition IN ('resellable','quarantine')),
  unit_amount_cents bigint NOT NULL CHECK (unit_amount_cents >= 0),
  PRIMARY KEY (store_id,return_id,sale_line_id),
  FOREIGN KEY (return_id,store_id) REFERENCES cash_sale_returns(id,store_id)
);
CREATE INDEX cash_return_lines_by_sale_line ON cash_return_lines(store_id,sale_line_id);

-- Registros anteriores foram devoluções integrais e já tiveram reposição de estoque.
-- Backfill meramente histórico, sem criar movimentos financeiros ou de estoque.
INSERT INTO cash_return_lines(store_id,return_id,sale_line_id,quantity,disposition,unit_amount_cents)
SELECT r.store_id,r.id,l.id,l.quantity::integer,'resellable',l.unit_price_cents
FROM cash_sale_returns r JOIN sale_lines l
  ON l.store_id=r.store_id AND l.sale_id=r.sale_id;
