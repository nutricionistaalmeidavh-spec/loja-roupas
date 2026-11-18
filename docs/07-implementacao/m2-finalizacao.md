# M2 — Catálogo e Estoque (implementação em branch)

**Branch:** feat/m2-finalizacao, PR #5 (empilhada sobre PR #4). Não mesclada à main nem publicada.

## Funcionalidades implementadas e verificadas
- Produto com cores, tamanhos e SKU canônicos, preço em centavos e código de barras.
- Edição de nome/categoria com `expected_revision`; atualização de preço por variante com revisão otimista.
- Fotos privadas armazenadas no PostgreSQL (`product_photos`, uma imagem principal por produto), PNG/JPEG/WebP até 2 MiB, tipo e assinatura conferidos; download autenticado e sem cache público.
- Listagem paginada com cursor estável sobre nome/UUID, busca por SKU/nome/código e filtro de categoria; até 50 por página.
- Recebimento de estoque idempotente, ajuste gerencial auditado por motivo e versão esperada, histórico de movimentos.
- UI React Retail Fashion conectada à API, imagem com `blob:` e revogação ao desmontar, carregamento de páginas, telas de cadastro/edição/foto/estoque.
- Migrações versionadas PostgreSQL, auditoria + outbox em cada alteração crítica.

## QA / restrições
- Testes unitários de cliente e domínio, integração de estoque/edição/foto/paginação com PostgreSQL real e Playwright de gestão e PDV passaram na última execução da PR.
- O catálogo limita cada página a 50 produtos; um produto pode ter várias variantes.
- **Limite atual:** foto original de até 2 MiB; thumbnails menores derivadas/otimizadas automaticamente ainda não são geradas. Imagens são servidas pelo servidor local sem CDN paga.
- **Limite atual:** edição de grade existente atua sobre nome/categoria e preço de variantes; alterar SKU/cor/tamanho de uma variante ou adicionar novas variantes a um produto já existente exige endpoint complementar/novo cadastro.
- Este estágio não inclui vendas/baixa por venda — elas estão sendo entregues em M3.
- A homologação de UX por humanos, hardening para produção e merge ficam pendentes.

**Core:** R$0, AGPLv3, PostgreSQL self-hosted, nenhuma integração comercial obrigatória.
