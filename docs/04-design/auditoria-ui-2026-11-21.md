# Auditoria técnica e refinamento de UI — 21/11/2026

**Produto:** Loja de Roupas ArtiSys. **Superfície:** Web/PWA React/Vite. **Referência canônica:** `docs/04-design/direcao-visual-retail-pos.md` e `design-system.md`. **Modo:** operação/PDV, sem redesign da identidade aprovada.

## Escopo e evidência

- Inspeção da `main` e screenshots Playwright do run 44850584625, commit `dc1c99dd...` (branch `fix/white-screen-recovery-20261120`), artefato `m2-ui-playwright-evidence` 14684967714.
- ZIP contém **36 PNG, três PDF e um relatório HTML**. Capturas: login, PDV, produtos, estoque, caixa, gestão, checkout, carrinho, confirmação, tablet e mobile 320/390.
- As capturas anteriores continham o tour sobreposto porque os specs de auditoria não o dispensavam; o teste de jornada atualizado nesta branch dispensa o tour antes das capturas. O teste próprio do onboarding permanece.
- Antes desta PR, a configuração geral do Playwright não gerava vídeo de execuções bem-sucedidas. Os três specs de auditoria/jornada passam a configurar vídeo explícito, sem alterar a experiência de produto.
- **Limites:** não foi feita auditoria automática axe de WCAG, perfilagem Web Vitals ou medição de toque físico. Não afirmar conformidade/performance validadas sem nova rodada específica.

## Veredito de integridade

A implementação possui fluxo comercial real e separação API/domínio, mas a execução visual diverge de seu contrato D4: há placeholders excessivos, componentes densos de planilha, IDs técnicos em superfície de venda, uso de siglas na rail e tokens aplicados de forma irregular. Um refinamento incremental no mesmo sistema de componentes é preferível à troca do shell.

**Score técnico preliminar, baseado nas evidências disponíveis (não certificação):** acessibilidade 2/4; performance 2/4 (sem métricas RUM); responsividade 2/4; tema/tokens 1/4; integridade visual/implementação 2/4. **Total 9/20.**

## Achados priorizados

| Prioridade | Evidência | Impacto e medida corretiva |
|---|---|---|
| P1 | `FirstRunTour.tsx`, `tour.css`, screenshots de checkout e gestão | Tutorial fica sobrepondo outras jornadas; quando checkout/dialog abre, ele ainda está presente. Definir exclusão mútua, fechamento/suspensão do tour em ações críticas e teste de foco/teclado |
| P1 | `App.tsx` fallback `Garment`, screenshot `02-pdv.png` | Silhuetas de camiseta reaparecem em saias/vestidos; a aparência de vitrine está crua. Fallback por tipo real do produto e fotos locais com prévia/crop consistente |
| P1 | `App.tsx` e `styles.css`, screenshots de 390/320 | A listagem longa não prioriza escaneamento rápido no mobile. Reorganizar busca, categorias, cards, barra fixa e navegação em densidade operacional adequada |
| P1 | Specs `visual-audit*.spec.ts` e `playwright.config.ts` | Evidências visuais ocultas por tour e ausência de gravação de vídeo. Corrigir instrumentação da QA nesta PR, sem mexer no app |
| P2 | `App.tsx` linhas da topbar/rail | Mostrar `Loja abc6da1d · manager` e `PRD/EST/GES/CFG` passa a sensação de sistema interno. Exibir nome da loja, função traduzida e ícones OSS com nomes acessíveis |
| P2 | `styles.css` | 187 literais hex de cor encontrados em um CSS de 333 linhas, com poucos tokens; centralizar as cores aprovadas em CSS custom properties e reduzir duplicações |
| P2 | `styles.css` | Botões de tamanhos com altura mínima 36px, abaixo da meta de 44px do D4 em contexto touch; ajustar touch targets, foco e espaçamento |
| P2 | Gestão e estoque, capturas desktop/mobile | Visual de tabela/formulário sem resumo e hierarquia, com vazios exagerados. Reorganizar sem inventar valores de BI ou mudar regras de negócio |
| P2 | `LoginScreen.tsx` | O login apresenta mensagens técnicas de instalação e auto-hospedagem ao operador. Mover tais instruções ao assistente/admin, mantendo ajuda contextual |
| P3 | `App.tsx` e componentes dispersos | O botão '+' nas cards é pouco explícito à primeira vista; verificar texto/tooltip contextual e acessibilidade durante seleção de variantes |

## Direção do refinamento

- **Base:** preservar branco `#FFFFFF`, canvas `#F7F7F7`, ink `#111111`, bordas suaves e café `#54463B` como acento raro, conforme D4. Referências `awesome-design-md` de Shopify (clareza comercial/commerce) e Linear (precisão da hierarquia), adaptadas a modo operacional e sem copiar marca.
- **Componentes canônicos:** `AppShell`, `IconRail`, `TopBar`, `ProductCard`, `VariantSelector`, `CartSidebar/Drawer`, `TaskDialog`, `DataTable`, `StatusBanner`, `EmptyState`. Unificar tokens e comportamento entre telas Web/PWA/Electron.
- **PDV desktop:** preserva 3 colunas a 1440px, rail compacta e carrinho estável. Dar mais peso a foto real, hierarquia nome/preço/grade; visualizar carrinho cheio e vazio em jornada real.
- **Mobile:** melhorar navegação entre módulos, tamanho de alvos, posição da busca, categorias e resumo fixo. Respeitar safe area e teclado virtual.
- **Cadastro/estoque:** cabeçalhos mais enxutos, filtros/pesquisa sempre claros, planilhas em container adequado, ações primárias e secundárias delimitadas.
- **Gestão/BI:** painel inicial usando apenas métricas existentes e consultáveis, com filtros consistentes, estados vazios/erro e tabelas legíveis. Nada de dados fictícios na operação.
- **Motion:** microtransições leves (120–180ms) para drawers, tabs, feedback de adicionar e estados de carregamento. `prefers-reduced-motion` e acesso por teclado são obrigatórios. GSAP open source somente em experiências públicas que se beneficiem, não como dependência de checkout.

## Gates para a próxima etapa

1. Capturas sem tour nos viewports 1440×900, 1366×768, 1280×800, 1024×768, 768×1024, 390×844 e 320×568, com dados consistentes.
2. Vídeos Playwright dos percursos desktop, mobile e compra/checkout; artefato hospedado em GitHub Actions, sem SaaS pago.
3. Verificação de scroll horizontal, foco, contraste, touch targets, inputs/erros e diálogo com >10 itens.
4. Testes de estados: carregando, sem foto, sem estoque, sem resultados, caixa fechado, servidor indisponível, timeout pós-commit, impressão pendente.
5. Somente após validar UI com operador, implementar refinamentos em PR de código separada desta PR de evidência; sem merge/release não autorizado.

**Nota:** Esta PR altera somente testes Playwright e documentação de auditoria; não altera telas de produção, API, banco, licenças ou secrets.
