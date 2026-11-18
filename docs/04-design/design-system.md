# D4 — Design system boutique premium / Retail Fashion POS

Versão conceitual **0.2** · Refinamento **UX-RPOS-01** sobre D16. Referência: captura “Lunatics – Retail POS Dashboard” fornecida pelo gestor. A hierarquia e a experiência são inspirações; criar uma interface **original**, sem copiar assets, código, marca ou composição pixel a pixel de terceiros.

## Fundamento visual aprovado
**PDV:** interface predominantemente branca, neutra e compacta, orientada a produtos de moda: **catálogo fotográfico em grade + seleção de variantes + carrinho visível**. **Demais módulos:** reaproveitar tipografia, ritmo, superfícies, componentes e acessibilidade; dashboards gerenciais podem manter detalhes mais quentes de marca. O SVG anterior creme/café baseado em lista **não é mais o padrão para implementar o PDV**.

## Tokens oficiais (fase D4)
| Token | Valor | Papel |
|---|---|---|
| color.canvas | #F7F7F7 | fundo principal do PDV |
| color.surface | #FFFFFF | cartões, carrinho e cabeçalho |
| color.ink | #111111 | textos primários e ações principais |
| color.ink-muted | #727272 | textos secundários (contraste a validar conforme tamanho) |
| color.border | #E8E8E8 | separadores e bordas leves |
| color.primary | #1E1E1E | botão principal, seleção e menu |
| color.primary-ink | #FFFFFF | texto de botão escuro |
| color.brand | #54463B | café como acento de marca, não fundo dominante do PDV |
| color.brand-soft | #F5F1EA | creme opcional em contextos boutique |
| color.success | #286B4A | confirmações acessíveis |
| color.warning | #9A5B16 | alerta, não único sinal |
| color.danger | #A02D2D | falha, estorno, bloqueio |
| color.thumb-bg | #F1F1F1 | thumbnail enquanto imagem carrega |

Tokens semânticos substituem hexadecimais embutidos. Contraste WCAG AA obrigatório para texto relevante; se cinza auxiliar não passar, usar tom mais escuro.

## Densidade, grid e tipografia
- Base 16 px para formulários; escala 12/14/16/20/24/32; preço e total em numeral tabular.
- Desktop >=1280px: **rail lateral 56–72px**; área central de produtos flexível; carrinho fixo no layout (largura sugerida 320–380px, podendo variar por viewport); catálogo com **3 colunas** de produtos em viewport normal 1366px ou superior.
- Desktop 1024–1279px: catálogo em 2 colunas ou painel de carrinho reduzido/alternável, **sem rolagem horizontal na tela**. Validar na resolução real.
- Tablet 768–1023px: catálogo 2 colunas; carrinho em drawer/painel acessível por botão com quantidade/total visíveis.
- Mobile 320–767px: catálogo 1 ou 2 colunas conforme legibilidade; barra fixa de resumo do carrinho e drawer de revisão; navegação adequada ao papel.
- Grids sem alturas rígidas que cortem tamanhos, preços, nomes ou fotos; thumb em razão consistente preferencialmente 4:5 ou quadrada; recorte com object-fit contain para peças quando necessário.
- Ritmo 4/8px, cards radius 10–14px, sombras muito discretas. Não usar neon, gradientes decorativos, fundos escuros grandes nem cards com informação supérflua.
- Toque mínimo 44x44px em ações críticas, foco visível, labels acessíveis mesmo no menu de ícones.

## Anatomia obrigatória do PDV
1. **Rail de navegação** com ícones e nomes acessíveis, item atual e ações de sair/configuração.
2. **Topbar** com loja, operador, status do caixa, status real do servidor LAN e busca global contextual.
3. **Barra de descoberta** com pesquisa de nome/SKU e entrada de código de barras prioritária, ativável por teclado sem perda de foco.
4. **Categorias horizontais**: Todos, Feminino, Masculino, Acessórios e categorias configuradas da loja (nunca hardcode).
5. **ProductCard**: foto real/local ou placeholder, nome, preço, grade de tamanho, swatches de cor, seleção inequívoca de variante e botão adicionar. Ausência de estoque é informada por variante, não apenas por produto.
6. **CartSidebar** persistente em desktop: miniaturas, variante escolhida, quantidade editável, remoção, totais, descontos/permissões e CTA “Ir para pagamento”.
7. **Pagamento em etapa/drawer separado**: dinheiro, Pix manual, cartão externo, crediário, gift card quando habilitado e pagamento misto; **nunca** concluir pagamento apenas ao selecionar método.
8. **Recuperação e auditoria**: rascunho suspenso, impressão pendente, timeout pós-commit, preço vencido, reserva e conflito de estoque.

## Componentes previstos
AppShell, IconRail, TopBar, SearchCombobox, BarcodeSearch, CategoryTabs, ProductGrid, ProductCard, ProductPhoto, VariantSelector, SizeChips, ColorSwatches, StockIndicator, PriceTag, CartSidebar, CartItem, QuantityStepper, CartSummary, CartDrawer, CheckoutDrawer, PaymentMethodPicker, PaymentSplitList, SaleConfirmation, ApprovalDialog, PermissionGuard, OfflineLANBanner, PrintQueueIndicator, RetryPanel, EmptyState, ErrorState, LoadingSkeleton, DataTable, AuditTimeline, MoneyInput, KPIWidget e CountGrid.

Uma única biblioteca compartilhada em React entre Electron e Web/PWA, com tokens CSS e testes de componentes. **Nenhuma regra canônica de saldo, preço, aprovação ou pagamento é calculada por componente.**

## Estados de UI obrigatórios
Loading com skeleton, ausência de imagens, variante indisponível, foto não carregada, busca sem resultados, cesta vazia, quantidade inválida, estoque alterado, edição simultânea, falta de permissão, promoção expirada, conectividade LAN perdida, checkout pendente após timeout, venda confirmada com impressão pendente e sucesso final. Estados devem ter mensagem explícita, não somente cor.

## Acessibilidade, rapidez e fidelidade
Navegação completa por teclado, foco previsível após scanner, contraste WCAG 2.2 AA, leitor de tela, botão com nome acessível e mensagens inline. Fotos otimizadas e lazy loading, imagem fallback do próprio core sem CDN obrigatória. Testar em >=1366x768, 1280x800, 1024x768, 768x1024, 390x844 e 320x568, com dados longos e produtos reais fictícios.

## Guias e artefatos
- [Especificação de referência Retail POS](direcao-visual-retail-pos.md) — documento principal do PDV.
- [Mockups estáticos](mockups-estaticos.md) — antigo legado e nova proposta, sem funcionalidade.
- [Jornadas](jornadas-e-wireframes.md), [catálogo de telas](catalogo-de-telas.md).
- A nova referência será critério de QA visual (QA-UX-01…12), **não substitui testes de fluxo de checkout**.

## Governança
Aprovação do layout visual no PR/documentação precede implementação. Não tomar a imagem do Dribbble como licença de uso dos recursos visuais de terceiros. O núcleo mantém R$ 0 / open source / self-hosted, inclusive fontes, ícones e bibliotecas de componentes.
