# P1 + P2 — fluxos operacionais, central de tarefas e QA

Status: PR empilhada em `feat/p0-operational-integrity-20261121` (PR #36). P1 + P2: PR #37. **Sem merge e sem release**.

## P1 — Processos e UX

### Máquina de estados compartilhada

`packages/domain/src/operations.ts` contém transições puras e contratos TypeScript usados por API/Web. Não há serviço externo ou dependência de execução adicional.

| Processo | Estados | Eventos válidos |
|---|---|---|
| Compras | awaiting_receipt, checked, legacy_receipt | receive apenas de awaiting_receipt |
| Retiradas | pending, cancelled, completed, expired | cancel, complete ou expire apenas de pending |
| Devoluções | confirmed, partially_returned, returned, cancelled | partial/complete somente de confirmed ou partially_returned |
| Reservas | active, released | release apenas de active |

Invariantes transacionais continuam no PostgreSQL: RBAC, `store_id`, saldos, travas e idempotência. **Um estado de UI não autoriza gravar em banco**.

### Operação orientada à tarefa

- O recebimento de compras usa diálogo acessível com contagem física, unidades aprovadas, reprovadas e faltantes, justificativa de divergências e confirmação explícita.
- O formulário de devolução recebe os tipos do domínio compartilhado: seleção por linha, quantidade e disposição (`resellable`/`quarantine`).
- Pedidos para retirada continuam sendo **solicitações sem reserva** por 48 horas, conforme contrato existente. O estado é calculado no mesmo domínio utilizado pela API.
- A central de ações, disponível na gestão, mostra prioridades com navegação direta para compras, retiradas, comprovantes, reservas e pós-venda.
- A central é responsiva, com títulos/ações acessíveis por teclado e sem duplicar dados entre telas.

## P2 — Painel operacional

`GET /v1/management/operations/summary` é uma consulta agregada por `store_id`, restrita a permissão gerencial.

Indicadores: compras sem recebimento, quantidades de compra reprovadas, quantidades faltantes, retiradas pendentes, reservas ativas, comprovantes pendentes, devoluções em quarentena, vendas parcialmente devolvidas e variantes de baixo estoque (limite fixo de até 3 disponíveis).

`generated_at` identifica a hora da consulta. Os números de quarentena são **ocorrências históricas registradas**, não saldo de peças físicas localizadas nem autorização para revenda. A conferência de compras anteriores ao P0 continua exigindo reconciliação manual: jamais reclassificar históricos automaticamente.

## QA obrigatório

- `pnpm --filter @loja/domain typecheck && pnpm --filter @loja/domain test`
- `pnpm --filter @loja/api typecheck && pnpm --filter @loja/web typecheck`
- `pnpm --filter @loja/api migrate && pnpm --filter @loja/api test` com PostgreSQL 17 efêmero.
- `pnpm --filter @loja/web test && pnpm --filter @loja/web build`
- `pnpm --filter @loja/web test:e2e`: cenários de operação, isolamento, foco no modal, escape, viewport de 390 px, pedido/retirada/venda/devolução e impressão simulada.
- O workflow `m1-integration.yml` instala **axe-core 4.10.3** apenas no diretório temporário do CI, com licença MPL-2.0 e sem alterar dependências do produto. Define `LOJA_AXE_CORE_PATH` e executa auditoria WCAG da central e diálogos. Para rodar localmente: instalar axe-core numa pasta QA temporária e definir a variável com o caminho do `axe.min.js`.
- O teste de impressão troca `window.print()` por um stub controlado, verificando prévia não fiscal, chamada ao driver e confirmação de fila; **não** comprova comunicação USB/Bluetooth física.
- Testes existentes de barras, PDF térmico 58/80 mm, instalação do pacote e LAN continuam nos gates M1/M8.

## Stack e licenças

Núcleo: TypeScript/React/Fastify/PostgreSQL self-hosted, R$0. A máquina de estados pequena foi implementada de forma pura no domínio do sistema, sem introduzir XState no executável ou exigir novo arquivo de lock. O motor OSS axe-core é somente ferramenta de teste, isolado da execução comercial. Integrações pagas não são usadas nem necessárias.

## Critérios de liberação

1. Checks M1 (API, migrations, Web e Playwright), domínio, LAN e M8 aprovados na cabeça **atual** da PR.
2. Garantia de isolamento por loja e ausência de regressões nos registros existentes.
3. Homologação real de periféricos (impressora, leitor, gaveta) e cópia de dados para migração.
4. Integração ordenada: primeiro PR #36, depois PR #37, sem publicar release até autorização expressa.
