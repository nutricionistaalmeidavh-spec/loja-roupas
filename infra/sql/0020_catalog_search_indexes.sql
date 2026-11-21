-- P1: busca textual indexada, ordenação estável e acesso às variantes por loja.
-- pg_trgm integra o PostgreSQL; nenhuma infraestrutura paga ou serviço externo.
-- Índices criados pela migração transacional existente, sem alterar tabelas nem dados.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Combina filtro de tenant e percurso por cursor (nome, ID).
CREATE INDEX IF NOT EXISTS products_store_name_cursor_idx
 ON products(store_id, name, id);

CREATE INDEX IF NOT EXISTS products_store_category_name_cursor_idx
 ON products(store_id, category, name, id);

-- ILIKE '%termo%' não é acelerado por B-tree comum.
CREATE INDEX IF NOT EXISTS products_name_trgm_idx
 ON products USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS variants_sku_trgm_idx
 ON product_variants USING gin (sku gin_trgm_ops);

-- A recuperação do catálogo por produto não deve varrer variantes de outras lojas.
CREATE INDEX IF NOT EXISTS variants_store_product_sku_idx
 ON product_variants(store_id, product_id, sku, id);
