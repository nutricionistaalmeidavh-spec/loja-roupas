# UX-CONTRACT.md — Loja de Roupas (Retail POS)

Contrato de interface observável, complementar ao `DESIGN.md`. Core obrigatório R$0, offline/LAN e self-hosted.

## Permissões / sessões
- Gestor: PDV, produtos, estoque, caixa, gestão e configurações.
- Caixa: PDV, caixa e configurações. Estoquista: PDV, estoque e configurações.
- Menu responsivo exibe somente seções autorizadas; nenhuma proteção de backend depende da visibilidade do menu.
- Nome comercial da loja e função legível; UUID e códigos de papel não são texto de navegação.
- Nenhum token de sessão em localStorage, interface ou log de apresentação.

## Navegação e dados
- O tour inicial é opcional e dispensável, nunca redefine a página após fechamento de modal.
- No desktop, rail acessível com `aria-current`; no mobile, ações por ícone + nome e `aria-current`.
- Todas as buscas reais usam API canônica e abortam respostas obsoletas; sem dados inventados para preencher telas.
- Produtos sem foto têm placeholder por categoria real; fotos autenticadas vêm do servidor local.
- Categoria, tamanho, cor, estoque e preço permanecem associados à variante exata.
- Gráficos representam exclusivamente registros reais: série vazia gera estado vazio, não barras falsas.

## Carrinho e checkout
- Carrinho é rascunho local; reservas, saldos e preços são revalidados no backend antes da venda.
- O único checkout usa validação e idempotência existentes, inclusive incerteza pós-timeout.
- Dinheiro, Pix manual e cartão externo exigem confirmação explícita; UX não presume pagamento bancário.
- Drawer tem foco inicial e armadilha de Tab, Escape fecha, fechamento retorna foco ao disparador.
- Tour não sobrepõe checkout nem outros diálogos operacionais.
- Toast de adicionar item não inventa confirmação de compra; apenas comunica adição ao rascunho.

## Qualidade
- Mínimo 44x44px nos controles de variantes e ações de toque; focus-visible com contraste.
- Responsividade testada em 320, 390, 768, 1024, 1280, 1366 e 1440px.
- `prefers-reduced-motion` reduz animações, sem bloquear a operação.
- Playwright: screenshots, vídeo e testes de regressão; CI PostgreSQL temporário; sem publicação de release durante QA.
- Não introduzir GSAP/Recharts/Tailwind/Radix/Vaul/Sonner como dependência silenciosa: adotar somente sob justificativa funcional,
  com versionamento no lockfile e validação do bundle. Referências visuais não implicam instalar bibliotecas.
