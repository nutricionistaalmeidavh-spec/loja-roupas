-- P2: histórico completo paginado por data e loja, sem alterar saldos.
CREATE INDEX IF NOT EXISTS stock_movements_store_history
 ON stock_movements(store_id,occurred_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS audit_logs_inventory_actor_lookup
 ON audit_logs(store_id,aggregate_id,action,occurred_at DESC,id DESC)
 WHERE action IN ('inventory.receipt','inventory.adjustment','purchase.receive','catalog.product.import');
