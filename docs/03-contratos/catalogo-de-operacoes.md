# D3 — Catálogo de operações e contratos pendentes por domínio

**Natureza:** inventário normativo de operações propostas a partir das 65 decisões, para revisão antes de código. O arquivo [OpenAPI 3.1](openapi/openapi.yaml) tipa em detalhe o fluxo inicial (bootstrap, cadastro, caixa, venda, estoque, benefícios etc.). Esta matriz cobre a superfície completa prevista e deverá ser traduzida para schemas OpenAPI específicos **antes da respectiva implementação**.

| ID | Domínio | Operação | Permissão | Invariante / resultado |
|---|---|---|---|---|
| API-001 | Identidade | POST /v1/auth/sessions | Público com rate limit | login + sessão |
| API-002 | Identidade | DELETE /v1/auth/sessions/current | identity.session.revoke | revogar sessão |
| API-003 | Identidade | GET /v1/users | identity.users.read | lista paginada |
| API-004 | Identidade | POST /v1/users | identity.users.write | criação auditada |
| API-005 | Identidade | PUT /v1/users/{id}/roles | identity.roles.manage | revisão + auditoria |
| API-006 | Identidade | POST /v1/devices/{id}/revoke | identity.devices.manage | revoga tokens |
| API-007 | Organização | GET /v1/stores | store.read | somente autorizadas |
| API-008 | Organização | PATCH /v1/stores/{id}/settings | store.settings.manage | expected_revision |
| API-009 | Catálogo | GET /v1/catalog/products | catalog.read | filtro SKU/categoria |
| API-010 | Catálogo | POST /v1/catalog/products | catalog.write | grade e SKU únicos |
| API-011 | Catálogo | PATCH /v1/catalog/products/{id} | catalog.write | versionamento |
| API-012 | Catálogo | GET /v1/catalog/variants/{id} | catalog.read | medidas e atributos |
| API-013 | Catálogo | POST /v1/catalog/kits | catalog.kit.manage | composição acíclica |
| API-014 | Catálogo | GET /v1/catalog/size-charts | catalog.read | marca/categoria |
| API-015 | Catálogo | GET /v1/catalog/collections | catalog.read | campanhas sazonais |
| API-016 | Estoque | GET /v1/stock/availability/{variantId} | stock.read | saldo/revisão |
| API-017 | Estoque | GET /v1/stock/movements | stock.read | histórico paginado |
| API-018 | Estoque | POST /v1/stock/counts | stock.count.open | contagem |
| API-019 | Estoque | POST /v1/stock/counts/{id}/submit | stock.count.submit | revisão |
| API-020 | Estoque | POST /v1/stock/counts/{id}/approve | stock.count.approve | gera movimentos |
| API-021 | Estoque | POST /v1/stock/losses | stock.loss.submit | avaria/bloqueio |
| API-022 | PDV | POST /v1/cash-sessions | cash.open | 1 ativo/terminal |
| API-023 | PDV | POST /v1/cash-sessions/{id}/movements | cash.move | sangria/suprimento |
| API-024 | PDV | POST /v1/cash-sessions/{id}/close | cash.close | contagem e justificativa |
| API-025 | PDV | POST /v1/sales/quotes | sales.quote | simulação sem escrita |
| API-026 | PDV | POST /v1/sales | sales.commit | ACID + idempotência |
| API-027 | PDV | GET /v1/sales/{id} | sales.read | recuperação de timeout |
| API-028 | PDV | POST /v1/sales/{id}/returns | sales.return | limites acumulados |
| API-029 | PDV | POST /v1/sales/{id}/suspend | sales.suspend | rascunho não confirmado |
| API-030 | PDV | GET /v1/sales | sales.read | escopo loja |
| API-031 | Pagamentos | GET /v1/payments/{id} | payments.read | sem PAN/CVV |
| API-032 | Pagamentos | POST /v1/payments/{id}/reconcile | payments.reconcile | referência externa |
| API-033 | Financeiro | GET /v1/ledger/entries | finance.read | razão/auditoria |
| API-034 | Financeiro | POST /v1/payables | finance.payables.write | origem única |
| API-035 | Financeiro | POST /v1/receivables/{id}/settlements | finance.receivables.settle | baixa rastreável |
| API-036 | Financeiro | GET /v1/finance/dre | finance.reports.read | competência/caixa |
| API-037 | Compras | GET /v1/suppliers | purchasing.read | score e evidências |
| API-038 | Compras | POST /v1/suppliers | purchasing.write | cadastro |
| API-039 | Compras | POST /v1/purchase-orders | purchasing.create | não automático |
| API-040 | Compras | POST /v1/purchase-orders/{id}/approve | purchasing.approve | alçada |
| API-041 | Compras | POST /v1/purchases/receipts | purchasing.receive | aceito/rejeitado |
| API-042 | CRM | GET /v1/customers | crm.read | minimização |
| API-043 | CRM | POST /v1/customers | crm.write | dados mínimos |
| API-044 | CRM | POST /v1/customers/{id}/consents | crm.consent.write | finalidade/canal |
| API-045 | CRM | GET /v1/customers/{id}/benefits | crm.benefits.read | saldo por ledger |
| API-046 | CRM | POST /v1/referrals | crm.referrals.create | antifraude |
| API-047 | Benefícios | POST /v1/gift-cards | benefits.issue | emissão |
| API-048 | Benefícios | GET /v1/gift-cards/{id} | benefits.read | mascara código |
| API-049 | Benefícios | POST /v1/gift-cards/{id}/redemptions | benefits.redeem | lock + ledger |
| API-050 | Benefícios | POST /v1/gift-cards/{id}/block | benefits.manage | motivo |
| API-051 | Atendimento | POST /v1/fitting-sessions | fitting.write | peças em prova |
| API-052 | Atendimento | POST /v1/tailoring-orders | tailoring.write | prazos/custos |
| API-053 | Pedidos | POST /v1/reservations | orders.reserve | sem oversell |
| API-054 | Pedidos | POST /v1/orders | orders.create | canal/entrega |
| API-055 | Pedidos | POST /v1/orders/{id}/transitions | orders.transition | máquina de estados |
| API-056 | Logística | POST /v1/fulfillments/{id}/attempts | delivery.update | tentativas |
| API-057 | Logística | POST /v1/fulfillments/{id}/complete | delivery.complete | prova protegida |
| API-058 | Preços | POST /v1/price-publications | pricing.draft | simulação |
| API-059 | Preços | POST /v1/price-publications/{id}/approve | pricing.approve | aprovação |
| API-060 | Preços | POST /v1/price-publications/{id}/activate | pricing.activate | vigência |
| API-061 | Impressão | POST /v1/print-jobs | print.submit | unique source+type |
| API-062 | Impressão | GET /v1/print-jobs/{id} | print.read | status |
| API-063 | Comercial | GET /v1/reports/sales | reports.read | filtros e premissas |
| API-064 | Comercial | POST /v1/goals | commercial.goals.write | período/escopo |
| API-065 | Comercial | POST /v1/campaigns/{id}/approve | commercial.campaigns.approve | consentimentos |
| API-066 | Comercial | GET /v1/forecasts | commercial.forecasts.read | estimativa |
| API-067 | Plataforma | POST /v1/imports/previews | import.preview | nenhuma escrita definitiva |
| API-068 | Plataforma | POST /v1/imports/{id}/commit | import.commit | aprovação |
| API-069 | Plataforma | GET /v1/audit-log | audit.read | dados mascarados |
| API-070 | Plataforma | POST /v1/backups | platform.backup | criptografia |
| API-071 | Plataforma | POST /v1/backups/{id}/verify | platform.restore.test | ambiente isolado |
| API-072 | Plataforma | GET /v1/health | público (sem PII) | health |
| API-073 | Privacidade | POST /v1/privacy/requests | privacy.request | exportação/eliminação condicionada |

## Contratos obrigatórios por rota
- Headers: Authorization por sessão (cookie+CSRF ou bearer opaco), X-Store-Id quando aplicável, request_id; todas as escritas críticas exigem Idempotency-Key.
- Esquemas: request/response tipados; erro application/problem+json; paginação cursor quando listas; filtros com validação; rev para controle concorrente.
- Proveniência: autor, origem, store_id, tempo e motivo de operações financeiras/auditáveis.
- Segurança: default deny; permissão matriz em autorizacao-erros-idempotencia.md; entradas de cliente nunca determinam totais nem alçadas finais.
- Dinheiro: amount_cents inteiro, sem ponto flutuante; imposto fiscal oficial não calculado no core.
- Tempo: UTC armazenado; timezone da loja no display; expiração com transação e relógio do servidor.
- Privacidade: atributos pessoais mínimos, masking; consentimento não é obrigatório para venda.
- WebSocket: exclusivamente tópicos autorizados, versionados, com cursor e recuperação por API; não confiar em eventos como fonte de saldo.

## Protocolos periféricos e integrações
Agente de impressão local, caso instalado, tem fila persistente com job_id, device_id, template_version e resultado; não recebe sessão completa de usuário ou acesso ao PostgreSQL. Interfaces de pagamento externo e fiscal são adaptadores **opt-in**, documentados separadamente se forem escolhidos. QR Pix estático/manual não significa confirmação automática de recebimento.

## Sequência de estabilização dos contratos
1. Publicar esquema e mock tipado do domínio (documentação pré-código).
2. Escrever consumer tests e fixtures fictícias.
3. Revisar permissão, eventos, erro, estado, idempotência e migração.
4. Validar OpenAPI localmente em parser/linter antes do PR de implementação.
5. Formalizar breaking changes em ADR + nova versão de endpoint/evento.

A matriz descreve interfaces previstas; não declara rotas implementadas nem esquema final já homologado.
