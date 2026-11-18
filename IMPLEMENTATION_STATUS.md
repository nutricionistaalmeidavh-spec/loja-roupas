# M1 — Execução inicial (sem release)
Branch: feat/m1-fundacao, derivada da documentação D0–D6, sem merge na main.

## Existe neste commit
- Monorepo pnpm/Turborepo + tsconfig.
- PostgreSQL de desenvolvimento em Docker Compose, com bootstrap de segredo gerado localmente sem intervenção manual em .env.
- Migração de base inicial, com loja, usuários, produto, variantes, estoque, idempotência e outbox. Sem endpoints de escrita expostos antes de auth/ACID.
- API Fastify com /health (liveness) e /ready (consulta real ao PostgreSQL).
- Frontend React/PWA inicial em estilo Retail Fashion: catálogo sintético, categorias, cor/tamanho, rascunho de carrinho, visão responsiva e botão de pagamento **desabilitado**.
- Casos de teste de carrinho/variantes com Node test runner. Electron inicia o mesmo frontend de desenvolvimento.

## Não existe ainda
- Autenticação funcional, permissões completas, vendas reais, pagamentos, estoque integrado na API, instalador final, build de release, sincronização WebSocket, backup/recovery completo.
- UI usa **dados fictícios** e preços ilustrativos; não cria movimentações financeiras.
- A migração SQL é baseline de desenvolvimento, não sistema de migrações para upgrades. Docker Compose inicia banco somente no primeiro volume novo; execução de migrações futuras exige runner dedicado.
- Dependências não foram instaladas neste ambiente isolado; build React/Fastify e teste de API com Fastify precisam ser executados em máquina/runner com acesso aos pacotes.
- O workflow inicial de CI exercita apenas testes puros de domínio.

## Comandos para ambiente de desenvolvimento
1. Node >=22.12, pnpm 10, Docker Compose e OpenSSL instalados.
2. `sh scripts/bootstrap-dev.sh` (gera senha aleatória e PostgreSQL local).
3. `pnpm install` (na primeira instalação gera lockfile; revisar e commitar lockfile antes da CI completa).
4. `set -a; . runtime/local.env; set +a; pnpm --filter @loja/api dev`.
5. Outro terminal: `pnpm --filter @loja/web dev`. Para Electron: `pnpm --filter @loja/desktop dev`.
6. `pnpm test` para regras de domínio.

Este bootstrap é **somente para desenvolvedores**, não substitui o wizard de instalação aprovado para usuários. O núcleo permanece gratuito, open source, self-hosted, sem serviço pago obrigatório. Sem segredos no Git, sem merge e sem release.


## Atualização M1 — autenticação, migrações e leitura de catálogo
- Hash de senha com scrypt + salt por usuário, token opaco criptograficamente aleatório e hash da sessão no PostgreSQL.
- Login com bloqueio básico de tentativas por IP/login em memória; **antes de produção**, substituir por bloqueio distribuído/durável para múltiplos processos.
- Checagem de sessão revogada/expirada e vínculo com store_id em cada rota privada. Perfis mínimos; papel de gestor criado somente por bootstrap único.
- Migrações SQL versionadas com checksums e lock transacional, sem segredos em repositório; Docker Compose não executa SQL automaticamente.
- Catalog GET escopado por loja e protegido por RBAC; ainda não cria produtos reais nem dá baixa de estoque.
- Comandos: sh scripts/bootstrap-dev.sh; pnpm install; exportar env local; pnpm --filter @loja/api migrate; bash scripts/bootstrap-admin.sh; iniciar API.
- Testes de auth e catálogo foram adicionados para CI. Checkout continua bloqueado.


## M2 em desenvolvimento (PR separado)
- API de escrita autenticada: POST /v1/catalog/products, com variações por SKU e valor em centavos.
- POST /v1/stock/receipts: entrada manual com reference_id, movimentação única e saldo sob UPSERT transacional.
- Idempotency-Key persistida no PostgreSQL por loja, ator e operação; fingerprint canônico, retries sem duplicar saldos/produtos.
- Outbox e audit_logs no mesmo commit; transações ACID e escopo store_id.
- Teste real com PostgreSQL em CI é obrigatório. Checkout e pagamento continuam desabilitados.
