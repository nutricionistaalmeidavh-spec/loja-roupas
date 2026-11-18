# D1 — Arquitetura C4 e decisões técnicas

## C1 — Contexto
~~~mermaid
flowchart TB
  gestor[Gestor] --> sistema[Loja de Roupas]
  caixa[Operador de caixa] --> sistema
  vendedor[Vendedor PWA] --> sistema
  cliente[Consumidor] --> sistema
  sistema --> impressora[Impressora / balança por agente local opcional]
  sistema -. "opt-in" .-> integracoes[Provedores fiscais / Pix / comunicação]
~~~

## C2 — Containers (execução local obrigatória)
~~~mermaid
flowchart TB
  desktop[Electron + React] --> api[API TS modular]
  pwa[Web/PWA React] --> api
  catalogo[Catálogo público] --> api
  api --> pg[(PostgreSQL canônico)]
  api --> fila[Outbox e worker local]
  fila --> pg
  api --> ws[WebSocket / eventos com cursor]
  ws --> desktop
  ws --> pwa
  fila --> agente[Agente de impressão opcional]
  api -. opcional .-> externos[Integrações externas]
~~~

## C3 — Componentes internos do monólito
~~~mermaid
flowchart LR
  edge[HTTP controllers + auth] --> svc[Application services]
  svc --> contrato[Domain contracts / eventos]
  svc --> repos[Repositories por módulo]
  repos --> db[(Schemas lógicos no PostgreSQL)]
  svc --> outbox[Outbox no mesmo commit]
  outbox --> worker[Consumers idempotentes]
~~~

## Organização futura proposta
- apps/api: Fastify + TypeScript (proposta de framework; substituir só via ADR).
- apps/web: React + Vite + PWA.
- apps/desktop: Electron com context isolation e IPC mínimo.
- apps/print-agent: utilitário opcional para integração de periféricos locais.
- packages/contracts: artefatos OpenAPI, JSON Schema e versionamento de eventos.
- packages/ui: design system compartilhado.
- packages/config: configuração tipada e validada.
- modules/<domínio>: serviços, domínio, repositórios, testes do próprio domínio.
- infra: manifesto Docker Compose, volumes e fluxos do instalador guiado (a implementar após D0–D6 aprovado).

## Invariantes
1. PostgreSQL tem uma única origem de escrita, através da API.
2. Não há acesso direto de React/Electron à base.
3. Cada módulo é dono lógico de seu esquema/tabelas; compartilhamento por contratos ou serviços públicos do módulo.
4. Transações que cruzam módulos dentro do monólito exigem orquestrador de aplicação explicitamente documentado.
5. Mensagens de evento não substituem a consistência de uma venda; transação de venda é atômica.
6. Alterações de schema devem ser compatíveis com versão anterior quando houver janela de atualização.
7. Modelos de leitura podem materializar visões, mas nunca se tornam nova fonte de verdade.

## Decisões de stack propostas para homologação
- HTTP: Fastify + JSON Schema/OpenAPI documentado; camada de aplicação em TypeScript.
- Persistência: driver PostgreSQL e migrações SQL versionadas; lógica crítica sempre explícita.
- Mensageria: outbox e worker em banco local, sem broker pago.
- Busca: PostgreSQL FTS + pg_trgm; índice exato para código de barras/SKU.
- Teste: Vitest, integração contra PostgreSQL real, Playwright, auditoria de dependências open source.
- CI: GitHub Actions quando disponível, com runners self-hosted como opção gratuita de execução.
- Logs/métricas: formatos abertos, ferramentas self-hosted opcionais; sem SaaS obrigatório.

Essas escolhas detalhadas não substituem as decisões de produto: são propostas documentais, ainda sem código nem benchmark.
