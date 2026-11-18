# ADR-0001 — Monólito modular e PostgreSQL canônico

- Status: proposta alinhada às decisões D26, D27, D34, D42, D44.
- Contexto: loja única inicial, operação LAN, módulos paralelos, mínimo custo operacional.
- Decisão: um backend modular com limites claros de domínio e um PostgreSQL autoritativo. Frontends desktop/PWA usam API HTTP e eventos WebSocket.
- Consequências positivas: transações ACID, diagnóstico simples, backups únicos, menor necessidade de infraestrutura.
- Trade-offs: deploy conjunto, disciplina de contratos e isolamento lógico obrigatórios.
- Rejeitado: microserviços obrigatórios, event sourcing total, SQLite por caixa com sincronização posterior.
- Evidência futura: testes que neguem escrita cruzada e comprovem integridade em concorrência.
