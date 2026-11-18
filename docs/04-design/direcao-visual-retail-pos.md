# UX-RPOS-01 — Direção visual oficial do PDV de moda

**Status:** aprovada como direção de produto pelo gestor; detalhamento documental em revisão no PR. **Data:** 17/11/2026. **Escopo:** interface do PDV desktop e adaptação do PDV Web/PWA, não remodelagem indiscriminada dos 48 módulos/telas.

## Origem e intenção
O usuário forneceu uma captura intitulada **“Lunatics – Retail POS Dashboard”**, no Dribbble, e preferiu sua organização à tela SVG construída inicialmente no repositório. A referência serve como orientação de **arquitetura de informação, visual e microinterações**, não como autorização para copiar código, imagens, marca, identidade de terceiros, licenças ou pixel-perfect.

### Mudança comparativa
| Aspecto | Mockup antigo (obsoleto) | Direção adotada |
|---|---|---|
| Fundo | creme dominante | branco/cinza neutro como base |
| Menu | sidebar marrom larga com textos | icon rail 56–72px, ícones acessíveis |
| Descoberta | lista de itens adicionados | catálogo fotográfico em grade de 3 colunas |
| Variantes | cor/tamanho descritos em texto | escolher cor/tamanho no próprio cartão |
| Carrinho | bloco de resumo à direita | painel persistente com miniaturas, qty, descontos, total |
| Busca | campo separado, pouco integrado | busca por nome/SKU/código e scanner prioritário |
| Pagamento | controles fixos no resumo | ação progressiva “Ir para pagamento” e etapa própria |
| Densidade | áreas vazias | compacto, legível e responsivo |
| Identidade | café/creme em quase toda a tela | preto/branco e café apenas como acento de marca |

## Anatomia e regras por viewport
- Desktop >=1366px: menu compactado, catálogo com 3 colunas visíveis e painel de carrinho sempre presente; viewport de referência 1440x900. Evitar rolagem horizontal.
- Desktop 1280–1365px: manter 3 colunas sempre que cartões preservarem conteúdo legível; carrinho estável ~320–380px; reduzir gaps em vez de amputar informações.
- 1024–1279px: catálogo em 2 colunas; carrinho alternável se necessário para preservar legibilidade, com resumo de total permanentemente acessível.
- 768–1023px: 2 colunas, categorias roláveis horizontalmente com foco e indicadores; drawer para carrinho.
- 320–767px: 1 ou 2 colunas conforme largura/elementos, barra de carrinho fixa (contagem/total), drawer de revisão, navegação adaptada ao operador.
- Ajustar a media query às dimensões reais, sem inferir pela plataforma (Electron/browser); escalar para 125% e 200% sem ocultar confirmação e foco.

## Anatomia do ProductCard
Foto de peça de vestuário de proporção consistente (4:5 ou square, preferir contain); fallback local com tipo/categoria e texto alternativo; nome (até 2 linhas sem cortar SKU essencial); preço efetivo e preço anterior quando promoção válida; tamanhos em chips; swatches de cores acompanhados de rótulos; status disponível/reservado/indisponível por variante; botão “Adicionar” destacado. Não permitir “Adicionar” em produto com múltiplas variantes sem seleção inequívoca.

### Fluxo de adicionar produto
1. Abrir categoria ou buscar por nome/SKU/EAN; scanner lê exatamente a variante se mapeada.
2. Se produto tiver 1 variante válida, selecionar automaticamente; caso contrário, exigir cor e tamanho; uma combinação = um SKU do catálogo.
3. Exibir preço vigente e disponibilidade informativa da variante para a loja autorizada; GET da API.
4. Adicionar ao carrinho único por variant_id e preço/versão de cotação, sem alteração do saldo em banco.
5. Aumentar qty exige conferência/feedback; backend ainda revalidará no commit.
6. “Ir para pagamento” abre a etapa de revisão, descontos autorizados, meios mistos e confirmação, nunca paga só por abrir o drawer.
7. Commit da venda é transacional e idempotente. Após timeout consultar status, não duplicar.

## Carrinho
- Sticky/fixo à direita no desktop sem sobrepor as cards; scroll independente se itens ultrapassarem viewport; resumo e CTA sempre alcançáveis.
- Cada linha mostra thumbnail, nome, marca opcional, cor, tamanho, quantidade editável, desconto e preço subtotal; botão de remover com nome acessível.
- Total calculado/revalidado na API; desconto só com permissão; loja/caixa/operador e servidor LAN visíveis no cabeçalho.
- CTA primário escuro “Ir para pagamento” / no passo seguinte “Confirmar venda”; separar claramente rascunho, suspender, pagar e estornar.
- Em PWA/mobile, carrinho em drawer com backdrop, foco preso no diálogo, rolagem e devolução de foco ao fechar.

## Busca, teclado e scanner
- Campo de SKU/código no cabeçalho do catálogo com botão de scanner e atalho; scanner que funciona como teclado (keyboard wedge) suporta enter como fim de leitura.
- Não capturar digitação durante foco em campos de formulário ou em leitor de tela; shortcuts documentados e configuráveis.
- Busca com debounce apropriado para nome, mas correspondência exata de código imediatamente, sem sugestão conflitante.
- Categorias configuráveis da base de dados; nenhum texto hardcoded como único catálogo.
- Com foto ausente ou carregando, busca/scan e checkout continuam funcionando.

## Padrões visuais e performance
- Neutros: #FFFFFF, #F7F7F7, #111111, #1E1E1E, #E8E8E8, #727272; café #54463B e creme #F5F1EA apenas acentos secundários.
- Fotos em armazenamento self-hosted, com variações de thumbnail otimizadas, lazy loading, dimensionamento responsivo e fallback original, sem CDN paga.
- Biblioteca compartilhada React/TS + CSS variables, ícones open source com licenças compatíveis. Nenhum pacote de UI, tema, serviço de fotografia ou fonte comercial obrigatório.
- Evitar card com foto pesada carregando na thread de checkout; scan e carrinho permanecem rápidos independentemente do carregamento da grade.

## Contratos e fonte canônica
ProductGrid usa busca/variantes do módulo de catálogo; VariantSelector expõe variant_id; CartSidebar modela draft local, mas preço final e saldo pertencem ao servidor; CommitSale é a única mutação que confirma venda e baixa estoque. WebSocket apenas invalida cache/atualiza visões. Nada de cópias de regra de desconto no frontend. Reusar rotas contratadas; qualquer novo endpoint exige revisão contract-first e PR de documentação.

## Critérios verificáveis de aceite (P0)
| ID | Resultado exigido |
|---|---|
| QA-UX-01 | 1440x900 e 1366x768: menu compacto, 3 colunas, cart sticky e total/CTA visíveis, sem horizontal scroll |
| QA-UX-02 | 1280x800: nenhuma informação importante truncada, sem sobreposição de painéis |
| QA-UX-03 | 1024x768, 768x1024, 390x844 e 320x568: adaptativo com drawer/resumo acessível |
| QA-UX-04 | Tamanho/cor produzem variant_id/SKU exato; combinações inválidas não adicionam |
| QA-UX-05 | Scanner por keyboard wedge, busca por SKU e clique no card criam mesmo item canônico de carrinho |
| QA-UX-06 | Desconto/preço/estoque alterados durante venda resultam em revisão e confirmação no servidor |
| QA-UX-07 | Operação completa pelo teclado, leitor de tela e foco previsível; contraste WCAG AA |
| QA-UX-08 | Sem imagem, timeout de imagem e carregamento lento não bloqueiam vender por scanner |
| QA-UX-09 | Carrinho sticky no desktop e drawer mobile comportam >10 itens sem perder total/CTA |
| QA-UX-10 | Queda WAN mantém PDV LAN; queda servidor LAN bloqueia pagamento confirmado e preserva rascunho |
| QA-UX-11 | Timeout após commit: mesma idempotency-key não duplica venda, estoque nem recibo |
| QA-UX-12 | Screenshot Playwright comparado ao mockup aprovado nos viewports definidos, com revisão humana de densidade, hierarquia e conteúdo (sem exigência de pixel-perfect da referência de terceiros) |

## Definição de pronto do design
- Componentes, tokens, anatomia, estados, responsividade e testes especificados (este documento).
- Homologação de mockup atualizado e revisão UX por gestor/operadores; a direção está escolhida, mas o protótipo navegável ainda não existe.
- Implementação somente após homologação D0–D6 e autorização de código.
- Sem merge na main/release automático.

## Relações
Requisitos D03, D04, D16, D18, D28, D35, D37, D38, D47, contratos D3, QA D5 e épicos EP-04, EP-06, EP-09, EP-10, EP-30. Referência do mockup anterior é histórico, não alvo de entrega.
