# M2 — Interface integrada ao servidor local

**Branch:** feat/m2-interface-integrada · **PR:** em revisão, sem merge e sem release.

## Implementado nesta entrega
- Login real por `POST /v1/auth/sessions`, sessão em memória, seleção de loja quando houver múltiplos vínculos, encerramento por `POST /v1/auth/sessions/revoke`.
- Dados do PDV obtidos em `GET /v1/catalog/products` no servidor PostgreSQL canônico. Nenhum fallback para catálogo fictício ao perder a API.
- Produto por grade: nome, categoria, SKU, cor, tamanho, preço em centavos, código de barras opcional. Módulo de cadastro protegido por perfil.
- Entrada manual de estoque por variante, quantidade e referência única; idempotency-key persistida para retries (reenvio ambíguo reaproveita chave e payload).
- Seleção de variante por cartão, busca por SKU e leitura por scanner keyboard-wedge com Enter, carrinho de rascunho (sem venda/baixa).
- Proxy Vite `/v1` para API local `127.0.0.1:3000`. Em produção a UI e a API precisam ser servidas no mesmo origin LAN/HTTPS pelo instalador futuro.
- Testes unitários de adaptação do catálogo, moeda BRL, cliente HTTP, autorização de headers e tratamento de erro.

## Como executar localmente em modo desenvolvimento
1. Instalar Node 22, pnpm 10, Docker e OpenSSL (core sem serviço pago).
2. `sh scripts/bootstrap-dev.sh` para gerar credencial local e iniciar PostgreSQL.
3. `pnpm install`, `set -a; . runtime/local.env; set +a`.
4. `pnpm --filter @loja/api migrate`.
5. `bash scripts/bootstrap-admin.sh` para criar usuário gestor (um único primeiro acesso).
6. Terminais separados: `pnpm --filter @loja/api dev` e `pnpm --filter @loja/web dev`.
7. Abrir `http://127.0.0.1:5173`. Não usar credenciais reais em issues ou prints.

## Limites e riscos conhecidos
- **Não é PDV pronto:** checkout e meios de pagamento permanecem desabilitados até M3; carrinho é rascunho e não reserva estoque.
- Cadastro visual usa **ilustrações placeholder**, não fotos reais. Upload/armazenamento de imagens self-hosted está pendente.
- Catálogo apresenta até 50 produtos por consulta; paginação e busca abrangente para estoque além deste limite serão tratados em nova entrega.
- Não há sessão persistente deliberadamente: atualizar a página exige autenticação novamente; nenhum token em localStorage.
- Dev Vite e Compose são ferramentas para desenvolvedores; instalador e disponibilidade na LAN pública serão parte de M4.
- **Validado em GitHub Actions:** build, tipagem, domínio, migrações PostgreSQL, testes de API e Playwright real (login → cadastro → entrada de estoque → carrinho desktop/mobile).
- Evidências de QA: https://github.com/nutricionistaalmeidavh-spec/loja-roupas/actions/runs/44307475803/artifacts/14429390478
- **Não confundir:** um E2E bem-sucedido não encerra o módulo M2 completo; faltam imagens, paginação abrangente e outros fluxos de cadastro/estoque, além da revisão visual humana.
- Sem emissão fiscal nativa. Comprovante não fiscal não substitui obrigações legais.
