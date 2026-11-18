# ADR-0005 — Outbox, consistência e idempotência

- Status: proposta alinhada a D35 e D37.
- Decisão: registros de domínio críticos e mensagens de outbox são persistidos na mesma transação PostgreSQL; workers consomem com lease, deduplicação e política de reprocessamento.
- Checkout é síncrono/atômico. Comunicação externa, impressão, notificações e materializações analíticas são efeitos pós-commit.
- Idempotency-Key por operação mutável crítica, com hash do payload e escopo loja+usuário+operação; mesma chave e mesmo payload retornam a mesma decisão final; payload distinto produz erro.
- Invariantes: um sale_id confirmado consome estoque uma vez; uma tentativa de pagamento validada gera lançamento uma vez; consumidor deduplica event_id.
- Erros desconhecidos após timeout obrigam leitura de status antes de nova tentativa.
