# D2 — Dicionário de dados canônicos

Tipos abreviados: UUID; TEXT; INT; BIGINT; NUMERIC; BOOL; TIMESTAMPTZ; JSONB. Todo agregado inclui id UUID, created_at, updated_at, revision BIGINT e store_id quando aplicável. Exclusão lógica somente onde houver obrigação de histórico.

| Entidade/tabela lógica | Dono | Campos relevantes além do padrão | Restrições/índices |
|---|---|---|---|
| stores | organização | name, timezone, currency, active | 1 loja inicial |
| workstations | organização | name, device_key, status | unique store+device_key |
| users | identidade | login, password_hash, status | login único |
| roles | identidade | code, label | code único |
| permissions | identidade | code | catálogo imutável/versionado |
| user_store_roles | identidade | user_id, store_id, role_id | unique user+store+role |
| sessions | identidade | user_id, device_id, revoked_at | expiração, hashes de tokens |
| devices | identidade | registration_fingerprint, active | bloqueio e revogação |
| products | catálogo | name, brand, category_id, description, active | busca textual |
| product_variants | catálogo | product_id, sku, barcode, color, size, status | unique store+sku; barcode conforme política |
| size_charts | catálogo | brand, category, measurements_json | versionado por grade |
| collections | catálogo | name, season, start_at, end_at | index season |
| kit_components | catálogo | kit_variant_id, component_variant_id, quantity | acíclico, quantidades positivas |
| product_media | catálogo | variant_id, content_ref, order | armazenamento local opcional |
| price_rules | preços | scope, expression, priority, validity, approval | sem regras conflitantes |
| price_publications | preços | version, status, approved_by, starts_at | status governado |
| price_entries | preços | publication_id, variant_id, amount_cents | unique publication+variant |
| stock_movements | estoque | variant_id, qty_delta, reason, source_type, source_id, operator_id | unique source_type+source_id+variant+movement_kind |
| stock_balances | estoque | variant_id, location_id, on_hand, reserved | unique store+variant+location; saldo não negativo quando aplicável |
| stock_reservations | estoque | variant_id, source_type, source_id, qty, expires_at, status | unique source_type+source_id+variant |
| stock_counts | estoque | location_id, status, opened_by, approved_by | fechamento imutável |
| stock_count_lines | estoque | count_id, variant_id, counted_qty, expected_qty | unique count+variant |
| stock_loss_cases | estoque | variant_id, qty, cause, approval | gera movement |
| sales | PDV | cash_session_id, customer_id, status, totals_cents, price_version | unique store+sale_number; imutabilidade após confirmação |
| sale_lines | PDV | sale_id, variant_id, qty, unit_price_cents, discount_cents, cost_snapshot_cents | total validado servidor |
| sale_returns | pós-venda | sale_id, reason, status, approved_by | impede devolver > vendido |
| sale_return_lines | pós-venda | return_id, sale_line_id, qty, amount_cents | controle cumulativo |
| payments | pagamentos | sale_id, method, amount_cents, status, external_ref | unique external_ref por adaptador quando existir |
| receivables | pagamentos | source_id, due_at, amount_cents, status, customer_id | vencimento |
| cash_sessions | financeiro | opened_by, opened_at, closed_at, counted_cents, status | única sessão ativa por caixa |
| cash_movements | financeiro | cash_session_id, kind, amount_cents, reason | append-only |
| ledger_entries | financeiro | source_type, source_id, account_code, debit_cents, credit_cents, posted_at | dupla partida ou razão operacional definido no ADR futuro |
| payables | financeiro | supplier_id, due_at, amount_cents, status | competência e caixa diferenciados |
| customers | CRM | display_name, normalized_contact, marketing_status | coleta mínima; acesso controlado |
| consents | CRM | customer_id, purpose, channel, granted, occurred_at, source | histórico por finalidade |
| loyalty_movements | CRM | customer_id, benefit_type, delta_cents_or_points, source_id | unique origem-benefício |
| gift_cards | benefícios | public_code_hash, issued_amount_cents, status, expires_at | código não exposto completo, regra legal revisada |
| gift_card_movements | benefícios | gift_card_id, delta_cents, kind, source_id | saldo >=0; unique origem |
| referrals | CRM | referrer_id, invited_id, campaign_id, attribution | antifraude |
| suppliers | compras | name, registration, contact, status | informação cadastral única |
| supplier_scores | compras | supplier_id, dimensions_json, evidence_count, period | não classificar sem amostra |
| purchase_orders | compras | supplier_id, status, approved_by, expected_at | PO único por loja |
| purchase_lines | compras | purchase_order_id, variant_id, qty, cost_cents | qty >0 |
| receipts | compras | purchase_order_id, received_by, status | recebimento parcial |
| receipt_lines | compras | receipt_id, purchase_line_id, qty_accepted, qty_rejected | não ultrapassar pedido sem exceção |
| consignments | compras | owner_id, variant_id, qty, settlement_terms | propriedade separada |
| fitting_sessions | atendimento | customer_id nullable, seller_id, status | log por peça |
| tailoring_orders | atendimento | sale_line_id, notes, price_cents, due_at, status | acesso restrito |
| reservations | pedidos | customer_id, variant_id, qty, expires_at, deposit_cents, status | reserva confirmada pelo estoque |
| customer_orders | pedidos | customer_id, channel, status, fulfillment_type, total_cents | chave externa opcional |
| order_lines | pedidos | order_id, variant_id, qty, unit_price_cents | preço snapshot |
| fulfillments | logística | order_id, driver_id, proof_ref, status, completed_at | prova de entrega restrita |
| campaigns | comercial | name, audience, schedule, approved_by | consentimento antes da execução |
| goals | comercial | metric, scope, starts_at, ends_at, target | período válido |
| forecasts | comercial | model_version, dataset_cutoff, assumptions, estimate, uncertainty | nunca overwrite de valor real |
| print_jobs | impressão | template_version, payload_ref, state, attempts | unique origem+tipo+versão |
| import_batches | plataforma | source_hash, mapping_version, preview, status | commit autorizado |
| audit_logs | plataforma | actor_id, action, target, before_hash, after_hash, reason | append-only lógico |
| outbox_events | plataforma | event_id, event_type, aggregate_id, version, payload, status | unique event_id |
| idempotency_records | plataforma | scope, key, request_hash, response_ref, status | unique scope+key |
| backup_jobs | plataforma | started_at, checksum, encrypted_ref, restore_verified | sem segredos |

## Regras gerais de privacidade
- Campos de contato e endereço com controles por finalidade e perfil.
- Não armazenar número completo de cartão bancário, CVV ou token de acesso em texto.
- Arquivos de comprovante de entrega e documentos de saúde não fazem parte do cadastro genérico.
- Persistir referências de objetos em armazenamento local ou self-hosted, com verificação de path e acesso.
- Políticas de retenção são configuráveis e precisam de revisão jurídica antes de exclusão definitiva.

## Índices e locking
- unique(store_id, sku); unique(store_id, sale_number); unique(scope,key) para idempotência.
- índices para store_id+variant_id, evento por aggregate_id+version, sessões por status.
- CHECK qty >=0 onde saldo/reserva, amount_cents >=0 para valores absolutos, enum de status via constraint/check.
- row-level lock no balanço de variante/local durante reserva e baixa; operações em ordem determinística para reduzir deadlocks.
- Índices de busca FTS/trigram sem expor registros privados em contexto público.
