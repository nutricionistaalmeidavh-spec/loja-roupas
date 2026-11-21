# DESIGN.md — Loja de Roupas ArtiSys

**Estado:** direção Retail Fashion POS aprovada (UX-RPOS-01), refinamento incremental.

A especificação de design completa e canônica está em
[`docs/04-design/design-system.md`](docs/04-design/design-system.md) e
[`docs/04-design/direcao-visual-retail-pos.md`](docs/04-design/direcao-visual-retail-pos.md).
Este arquivo identifica o mapeamento de execução; não altera decisões da D4.

## North Star

Um PDV de loja de moda que parece uma ferramenta profissional de balcão:
nítido, rápido, leve e fotografado onde a loja efetivamente enviou imagens.
O vendedor reconhece a peça, escolhe uma variante real e conclui a venda com
o carrinho sempre acessível, sem misturar marketing e operação.

**Não fazer:** dashboard genérico de cartões, gradientes decorativos, modo escuro
como base, iconografia de texto/emoji, cores saturadas, catálogo de estoque fictício,
animações pesadas, IDs técnicos no cabeçalho ou tour sobre a conclusão da venda.

## Visual e fontes

- Canvas `#F7F7F7`; superfícies brancas `#FFFFFF`; ink `#111111`;
  primário `#1E1E1E`; borda `#E8E8E8`; café `#54463B` só em acentos.
- Fonte: `system-ui` da plataforma; sem download comercial obrigatório.
  Escala 12/14/16/20/24/32, preços e valores com numerais tabulares.
- Ícones são SVGs internos (`apps/web/src/UiIcon.tsx`), stroke 1.7, com
  `aria-label` nos controles.
- Card de produto tem proporção de foto estável, preço explícito,
  cor e tamanho selecionáveis, indicação de saldo por variante e ação “Adicionar”.
- Sem foto: ilustração neutra por tipo real da peça; jamais simular foto de cliente.
- Transições operacionais 120–180ms, apenas em transform/opacity e propriedades
  leves, com alternativa `prefers-reduced-motion`.

## Responsividade

- >= 1280: rail compacta, catálogo 3 colunas, carrinho visível à direita.
- 1024–1279: catálogo 2 colunas; carrinho adaptado sem corte horizontal.
- 768–1023: catálogo 2 colunas, carrinho em drawer.
- 366–767: catálogo 2 colunas quando possível, botões touch >=44px,
  carrinho fixo; até 365px, catálogo de 1 coluna para não truncar controles.
- Drawer e checkout têm foco previsível, fechamento acessível e não competem
  com o guia de primeiro acesso.

## Ownership da implementação

- Tokens de execução: `apps/web/src/retail-polish.css`.
- CSS existente: `apps/web/src/styles.css` (compatibilidade legada).
- Layout/navegação/carrinho: `apps/web/src/App.tsx`.
- Modelagem de categoria e variante: `apps/web/src/catalog-model.ts`.
- Diálogo de tarefa: `apps/web/src/TaskDialog.tsx`.
- Wizard de onboarding: `apps/web/src/FirstRunTour.tsx`.
- Checkout: `apps/web/src/PosCheckout.tsx`.
- Gestão e KPIs existentes: `apps/web/src/StoreOperations.tsx`.
- Contratos da sessão e nome da loja: `apps/api/src/auth.ts` e
  `apps/web/src/api-client.ts`.

## Gates

Execução Playwright com capturas desktop/mobile e vídeo da jornada em
`apps/web/e2e`. O workflow `m1-integration.yml` sobe Postgres/servidor
self-hosted e publica `m2-ui-playwright-evidence`.
Não substituir cobertura por screenshots; validar teclado, dados reais, estados
vazios/erro, reentrada, pagamento e idempotência.

**Custo do núcleo: R$ 0.** Open source, self-hosted, sem plugin,
biblioteca de fontes comercial, CDN ou serviço de nuvem obrigatório.
