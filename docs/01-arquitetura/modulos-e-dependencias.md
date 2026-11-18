# D1 — Fronteiras de módulos e contratos de colaboração

| Módulo dono | Entidades canônicas | Serviços que oferece | Eventos de saída |
|---|---|---|---|
| Identidade | user, role, permission, session, device | autenticação, autorização, troca PIN | identity.session.revoked |
| Organização | store, workstation, settings | loja ativa e parâmetros | store.settings.changed |
| Catálogo | product, variant, size_chart, collection, kit | SKU, grade, composição, precificação de referência | catalog.variant.changed |
| Estoque | stock_movement, stock_balance, count | disponibilidade, reserva, baixa, devolução | inventory.stock.changed |
| Preços | price_rule, price_publication | calcular preço efetivo, validar desconto, publicar | pricing.publication.activated |
| PDV | sale, sale_line, checkout | criar, suspender, confirmar, cancelar, recuperar | sales.sale.confirmed |
| Pagamentos | payment, settlement, receivable | autorização manual, reconciliação, crediário | payments.recorded |
| Financeiro | cash_session, ledger_entry, payable | caixa, conciliação, DRE operacional | finance.cash.closed |
| Clientes | customer, consent, loyalty | cadastro mínimo, preferências, benefícios | crm.consent.changed |
| Compras | supplier, purchase_order, receipt | sugestão, aprovação, pedido, recebimento | purchasing.receipt.accepted |
| Atendimento | fitting_session, reservation, tailoring_order | provador, reserva, costura | service.reservation.created |
| Pedidos | customer_order, fulfillment | compra online, retirada e entrega | orders.status.changed |
| Impressão | print_job, print_template | fila de etiquetas/comprovantes | print.job.completed |
| Comercial | goal, campaign, forecast | metas, análises locais e recomendações | commercial.campaign.changed |
| Plataforma | import_batch, audit, outbox, backup_job | integração, auditoria, backup e saúde | platform.backup.verified |

## Política de integração
- A unidade mínima de propriedade é o agregado/tabela canônica; somente o módulo dono pode persistir.
- API de aplicação pública é o único caminho de escrita entre domínios. Leitura transversal pode usar projeções de consulta explícitas e documentadas.
- Regras não podem ser duplicadas em frontend, jobs ou outro módulo. UI pré-visualiza; backend calcula e valida.
- Efeitos assíncronos: evento versionado, outbox transacional, consumidor idempotente, deduplicação por event_id.
- Operações fiscais, de marketing e pagamento externas não fazem parte da transação de venda LAN; fila marca pendência e permite conciliação.

## Dependências funcionais prioritárias
- Venda: identidade + loja + catálogo + preço + estoque + pagamentos + financeiro.
- Pedido online: catálogo + preço + estoque + cliente + pedidos + logística.
- Kit: catálogo/composição + preço + estoque + impressão.
- Gift card: clientes/benefícios + pagamentos + PDV + financeiro.
- Troca: venda original + estoque + financeiro + auditoria.
- Recebimento de fornecedor: compras + estoque + custo/financeiro.
- Business intelligence: projeções provenientes de eventos e consultas autorizadas sem mutar domínio operacional.

## Organização de equipes/agentes em paralelo
Cada frente: contrato próprio, testes de produtor/consumidor, migração compatível, documentação de permissões, fixture mínima e interface de integração. Proibidos imports diretos de repositórios internos de outros módulos. Mudança pública exige PR de contratos primeiro e aprovação.
