# D3 — Catálogo versionado de eventos e tempo real

Contratos são proposta documental, não implementação. Nomes de eventos seguem namespace.versão para impedir breaking silencioso. Todo evento tem event_id UUID, aggregate_id UUID, aggregate_revision BIGINT, store_id UUID, occurred_at UTC, causation_id, correlation_id, actor_id opcional e payload mínimo. Versionamento de envelope: schema_version; exemplo: sales.sale.confirmed.v1.

## Eventos canônicos
| ID | Evento | Produtor | Consumidores previstos | Payload mínimo |
|---|---|---|---|---|
| EVT-01 | catalog.variant.changed.v1 | catálogo | busca, vitrine, impressão | variant_id, revision |
| EVT-02 | inventory.stock.changed.v1 | estoque | PDV UI, reserva, alertas | variant_id, balance_revision |
| EVT-03 | sales.sale.confirmed.v1 | PDV | impressão, dashboards, CRM | sale_id, total_cents |
| EVT-04 | sales.sale.returned.v1 | pós-venda | financeiro, CRM, BI | return_id, sale_id |
| EVT-05 | finance.cash.closed.v1 | financeiro | BI, auditoria | cash_session_id |
| EVT-06 | payments.recorded.v1 | pagamentos | financeiro, alertas | payment_id, status |
| EVT-07 | purchasing.receipt.accepted.v1 | compras | estoque, custo | receipt_id |
| EVT-08 | pricing.publication.activated.v1 | preços | PDV, catálogo, impressão | publication_id, version |
| EVT-09 | orders.status.changed.v1 | pedidos | logística, atendimento | order_id, status |
| EVT-10 | crm.consent.changed.v1 | CRM | campanhas | customer_id, purpose, granted |
| EVT-11 | benefits.gift_card.moved.v1 | benefícios | financeiro, auditoria | card_id, movement_id |
| EVT-12 | print.job.completed.v1 | impressão | atendimento | print_job_id |
| EVT-13 | identity.session.revoked.v1 | identidade | WebSocket, desktop | session_id |
| EVT-14 | commercial.campaign.changed.v1 | comercial | BI, publicação | campaign_id, state |
| EVT-15 | platform.backup.verified.v1 | plataforma | administração | backup_job_id, checksum |

## Política de entrega
- Evento aparece na outbox no **mesmo commit** do agregado. Não emitir evento de venda antes do commit.
- Consumidor pelo menos uma vez; deduplicar por event_id e versão. Ordem preservada por aggregate_id+revision quando necessária.
- Retry exponencial com limite e parking/dead-letter em PostgreSQL, com inspeção pela administração; nunca duplicar mutação.
- Erro permanente não bloqueia checkout já confirmado; tarefa fica pendente e observável.
- Não copiar contato, endereço, dados pessoais ou secrets para eventos sem necessidade; usar IDs.
- Mudança aditiva é mantida na mesma versão somente se consumidor tolerar campo adicional; mudança de significado ou remoção exige evento v2 e janela de coexistência.

## WebSocket de atualização
1. Conectar somente autenticado no servidor LAN/remoto autorizado.
2. Inscrever por store_id e tópicos permitidos, com cursor persistido no servidor.
3. Ao reconectar: informar last_event_id/cursor; servidor retorna eventos pendentes dentro da janela.
4. Cursor expirado: indicar ressincronização por GET de projeção, não confiar em histórico incompleto.
5. Eventos são **sinais de invalidar/refazer leitura**; o banco e endpoints GET são canônicos.
6. Revogação de sessão termina conexões, e RBAC filtra payloads/assinaturas.

## Contrato exemplo
~~~json
{
  "event_id": "8f4f0c25-64b0-4ad3-96ad-7cff87298c00",
  "event_type": "inventory.stock.changed.v1",
  "schema_version": 1,
  "store_id": "a7eec688-f0d4-4190-9bc4-18d87963ab83",
  "aggregate_id": "c1d71baa-e649-4d5a-a59f-2a0d4f89943d",
  "aggregate_revision": 42,
  "occurred_at": "2026-11-17T20:00:00Z",
  "correlation_id": "sale-example",
  "payload": { "variant_id": "c1d71baa-e649-4d5a-a59f-2a0d4f89943d", "balance_revision": 42 }
}
~~~
