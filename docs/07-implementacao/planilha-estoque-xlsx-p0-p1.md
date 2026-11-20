# P0/P1 — Planilha integrada de produtos e estoque

## Escopo implementado

- Produtos → **Importar planilha**: upload local de XLSX (até 5 MB) ou CSV UTF-8 (até 1 MB), prévia validada e operação atômica de cadastro pelo endpoint canônico `/v1/catalog/products/import`.
- Modelos XLSX e CSV gratuitos para download diretamente no modal. Uma linha representa um SKU (cor/tamanho); código de barras é coluna textual para preservar zeros à esquerda.
- Produtos → **Planilha editável** e Estoque → **Planilha operacional**: mesmo componente, via React Data Grid OSS, com edição de nome, categoria, SKU, cor, tamanho, código de barras e preço por variante.
- Apenas campos cadastrais podem ser editados; estoque físico, reservado, disponível e totais de movimentos são leitura calculada pelo PostgreSQL, nunca preenchimento manual de saldo.
- Backend `GET /v1/stock/spreadsheet`: busca, filtro de categoria, paginação (50 linhas por página) e totais de estoque agregados de `stock_balances` e `stock_movements` por loja e variante.
- Backend `PATCH /v1/stock/spreadsheet/rows/:id`: gravação atômica e versionada, idempotência, auditoria, outbox, checagem de loja e permissão `catalog.write`.
- Por linha: **Receber**, **Ajustar** (gerente) e **Histórico**. Reutilizam formulários e contratos de estoque já existentes, inclusive verificação de revisão, chaves idempotentes e trilha de auditoria.
- Sincronização entre computadores: nova consulta ao servidor em até 15 segundos e ao voltar à aba. Rascunhos não salvos são mantidos sem substituição automática; UI alerta dados novos.
- XLSX da página atual do estoque, exportado no navegador (não altera o banco).

## Fonte canônica e movimentações

O PostgreSQL é a única fonte de verdade:
- Entrada manual e recebimento de compra: movimentos positivos com `movement_kind=receipt`.
- Venda confirmada: `sale` com delta negativo, baixando saldo em transação.
- Devolução: `return` com delta positivo.
- Ajuste com justificativa: `adjustment` com delta assinado.
- Estoque disponível = `stock_balances.on_hand - stock_balances.reserved`.
- Entradas, saídas e ajustes visíveis na planilha provêm exclusivamente do livro `stock_movements`. Não existe planilha paralela com saldo independente.

## Permissões, erros e limites

- Leitura exige `stock.read`, edição exige `catalog.write`, entrada exige `stock.receive`. Ajuste exige a permissão já aplicada no endpoint de estoque.
- Importações compartilham os limites do backend: 100 produtos e 2.000 variantes, 200 variantes por produto. SKU e código de barras devem ser únicos. Em caso de conflito, a importação é revertida integralmente.
- Tipos, preços e inteiros XLSX são normalizados e validados antes do POST. Códigos de barras numéricos XLSX são rejeitados por risco de zeros à esquerda perdidos.
- Cabeçalhos exigidos: `produto, categoria, sku, cor, tamanho, preco, codigo_barras, estoque_inicial`. Dados de saldo corrente não pertencem à importação.
- Arquivos de planilha nunca são enviados a serviços externos. No servidor só chegam os objetos validados da operação de cadastro.
- Edição com revisão obsoleta retorna HTTP 409; falha de comunicação admite repetição com a mesma chave/payload, sem duplicação.
- Paginação e exportação indicam explicitamente que representam somente a página atual.

## Ferramentas R$0, OSS

- `read-excel-file`: leitura de XLSX no navegador.
- `write-excel-file`: geração/download XLSX.
- `react-data-grid`: grade interativa.
- PostgreSQL, React, Fastify e Playwright já faziam parte do projeto.

Não há requisito de SaaS, pagamentos, API terceirizada, assinatura, serviço hospedado ou manipulação de segredos.

## Cobertura de QA

- Testes do parser XLSX: tipos, cabeçalho, código de barras textual e precisão.
- Teste de integração PostgreSQL: origem do estoque, agregação de movimentos, versões, RBAC, isolamento e ausência de edição direta do saldo.
- Playwright: upload XLSX, prévia/importação, planilha, movimentações, recebimento, edição e imagens desktop/mobile.

Não misturar os artefatos do CI com publicação de release; revisão do PR antes do merge.
