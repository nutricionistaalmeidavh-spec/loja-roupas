# ADR-0002 — Operação LAN-first sem internet pública

- Status: proposta alinhada às decisões D11, D36, D37.
- Contexto: vendas precisam sobreviver à queda da internet, mas não à queda da rede/servidor local.
- Decisão: API e PostgreSQL ficam no servidor local. Caixas Electron e PWA o acessam na LAN. Rascunhos no cliente não representam vendas concluídas.
- Acesso remoto: opt-in por HTTPS/VPN.
- Consequência: sem conflito de sincronização entre bancos; servidor e rede LAN viram componentes críticos.
- Aceite: desligar WAN e vender na LAN; desligar servidor e comprovar bloqueio de confirmação e preservação de rascunho seguro.
