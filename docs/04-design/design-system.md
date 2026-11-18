# D4 — Design system boutique premium

Versão conceitual 0.1. Especificação de tokens para React desktop/PWA. A implementação, biblioteca de componentes e validação visual ocorrerão depois da homologação da documentação.

## Marca visual
| Token | Valor | Uso |
|---|---|---|
| color.canvas | #F5F1EA | fundo creme |
| color.brand | #54463B | café, destaques e ações principais |
| color.ink | #302B26 | texto primário |
| color.ink-muted | #705A48 | texto secundário, quando contraste aprovado |
| color.surface | #FFFFFF | cartões e listas |
| color.surface-alt | #EAE2D8 | fundos discretos |
| color.border | #D8D0C6 | separadores |
| color.success | #286B4A | sucesso, após contraste |
| color.warning | #9A5B16 | atenção, após contraste |
| color.danger | #A02D2D | erro, após contraste |

**Diretriz:** minimalismo premium, superfícies claras, texto de alta legibilidade, nenhum efeito neon e nenhum gradiente obrigatório. Cores de status nunca como único indicador.

## Tipografia e escala
- Stack de fontes do sistema para evitar download/licença externa obrigatória; alternativas locais de leitura.
- Escala tipográfica: 12, 14, 16, 20, 24 e 32 px; base 16 px; nomes/valores de dinheiro em numerais tabulares.
- Grid 4/8 px, espaços 4/8/12/16/24/32 px, radius 8/12/16 px, sombra leve.
- Largura de conteúdo desktop recomendada 1280 px com painéis; PWA desde 320 px; toque de pelo menos 44x44 px nos controles críticos.
- Contrast ratio WCAG AA no texto, estados de foco visíveis, labels reais, não depender de placeholder, navegação por teclado e leitor de tela.

## Componentes conceituais obrigatórios
AppShell, SideNav, TopBar, SearchCombobox, BarcodeField, VariantGrid, ProductCard, DataTable, MoneyInput em centavos, QuantityStepper, StatusChip, PaymentMethodPicker, PaymentSplitList, PermissionGuard informativo, ApprovalDialog, ConfirmDialog, AuditTimeline, PriceHistory, KPIWidget, FilterBar, DateRange, EmptyState, ErrorState, OfflineLANBanner, RetryPanel, PrintQueueIndicator, CountGrid, Drawer, Toast e LoadingSkeleton.

## Estados de qualquer tela
- Inicial/carregando; sem resultados; validação inválida; falta de permissão; conflito por edição simultânea; servidor LAN indisponível; sucesso; sucesso parcial com impressão pendente.
- Foco devolvido ao elemento que disparou modal; mensagens de erro vinculadas ao campo.
- Desabilitar confirmação não é suficiente: servidor revalida estoque, preço e autorização.
- Campos de moeda mostram R$ e centavos; converter entrada à unidade inteira canônica no submit.
- Não renderizar múltiplas fontes de saldo como se fossem equivalentes: a versão/revision vem do servidor.

## Layouts
**Desktop:** navegação lateral, cabeçalho com loja/operador/estado do servidor, área de trabalho principal e drawer contextual.
**PWA vendedor:** navegação inferior (Catálogo, Atendimento, Pedidos, Perfil), cartão de produto e fluxo de provador acessível com uma mão.
**PDV:** estrutura orientada à tarefa (buscar/ler, revisar itens, pagamentos, confirmar) com recuperação de checkout pendente.
**Admin:** módulos por área, relatórios filtros persistentes e controles perigosos com confirmação.

## Guia de escrita
Rótulos curtos em português do Brasil; separar "Saldo disponível", "Reservado" e "Em mãos"; diferenciar "Salvar rascunho", "Confirmar venda" e "Solicitar aprovação". Mensagens devem explicitar impacto, ação necessária e quem pode autorizar.

## Prototipação e aceite
Os wireframes e inventário de telas são entregáveis D4 documentais. Antes de codificar, revisar telas responsivas, contraste real, componentes e estados com usuários representativos; produzir protótipo visual/navegável aprovado em ferramenta open source ou HTML local somente mediante autorização da fase de implementação.
