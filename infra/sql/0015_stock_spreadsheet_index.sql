-- Planilha operacional: lookup paginado de movimentacoes por loja/SKU.
-- Index additive (sem alterar dados, saldos ou migracoes anteriores).
CREATE INDEX IF NOT EXISTS stock_movements_store_variant_time
 ON stock_movements(store_id,variant_id,occurred_at DESC,id DESC);
