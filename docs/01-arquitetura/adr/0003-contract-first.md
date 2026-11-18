# ADR-0003 — Desenvolvimento paralelo contract-first

- Status: proposta alinhada às decisões D25, D62, D63, D64, D65.
- Decisão: artefatos OpenAPI/eventos/permissões e schema são revisados antes de implementação dos consumidores.
- Módulos podem avançar em paralelo com doubles/fixtures oficiais, mas sem imports de internals, migrações conflitantes ou API não documentada.
- Compatibilidade: adicionar campos opcionais é compatível; remover/renomear ou mudar significado é breaking e exige versão.
- Gates: lint do contrato, mock/consumer tests, integração com PostgreSQL, E2E nos fluxos críticos, auditoria de licença, migração e restauração ensaiada.
- Governança: branch e PR; sem merge na main nem release sem comando explícito do gestor.
- Sequência: D0–D6 documentados, revisão, homologação, só então autorização para código.
