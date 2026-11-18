# Roadmap final — Loja de Roupas

**Base:** 65 decisões encerradas + refinamento UX-RPOS-01. **Status:** documentação em PR de revisão; código não autorizado. Sem datas/prazos artificiais, pois capacidade da equipe e hardware-alvo ainda não foram definidos.

## Princípios
Core **R$ 0, open source (AGPLv3 prevista) e self-hosted**; integrações pagas exclusivamente opcionais, explicitamente autorizadas. Inicialmente loja física única, modelo multi-filial-ready; React/TypeScript + Electron + Web/PWA; monólito modular com PostgreSQL autoritativo e API REST/OpenAPI, WebSocket/outbox; LAN opera sem internet, porém não sem servidor local. Desenvolvimento paralelo de todos os módulos, contratos versionados antes de código, validação por gates. Merge na main e release sempre exigem autorização independente.

**Direção visual do PDV P0:** [Retail Fashion POS — UX-RPOS-01](../04-design/direcao-visual-retail-pos.md). Catálogo fotográfico em grade 3 colunas desktop, menu de ícones compacto, filtros de categoria, seleção cor/tamanho/SKU no card, scanner e busca, carrinho persistente lateral desktop e drawer mobile, etapa de pagamento separada. Branco/cinza/preto dominam o PDV; café/creme são acentos. Desenho original, sem cópia de assets de Dribbble.

## Marcos e critérios de saída

| Marco | O que integrar | Épicos | Gate obrigatório |
|---|---|---|---|
| M0 — Homologar documentos | D0 PRD, D1 C4/ADRs, D2 dados, D3 contratos, D4 UX visual, D5 QA e D6 planejamento | documental | revisão e autorização explícita antes de código |
| M1 — Fundação | monorepo pnpm/Turborepo, DB/Docker Compose, auth/RBAC/loja, testes de contrato | EP-01..03 | instalação LAN sem conta/pagamento externo; RBAC seguro |
| M2 — Dados de varejo | produtos, cores/tamanhos, SKU, fotos e thumbnails, estoque, preço vigente | EP-04..06 | unicidade; locks e saldos corretos; preços por variante |
| M3 — PDV visual funcional | caixa, métodos mistos, grade de roupas, filtros, scanner, carrinho, checkout, impressão | EP-07..10 | QA-UX-01..12, venda idempotente e baixa única |
| M4 — P0 homologado | instalador guiado, backup, restore, outbox, logs, segurança, atualização assistida | EP-11,12,30 | WAN-off funciona, LAN-off bloqueia commit, restore demonstrado; zero P0/P1 |
| M5 — P1 gestão | devoluções/trocas, crediário, finanças/DRE, fornecedores, compras, contagens, comissões, CRM, importador, busca | EP-13..20 | reconciliação, autorização, LGPD, testes end-to-end |
| M6 — P2 experiências | provadores, reservas, catálogo público, pedido/retirada/entrega, gift cards, kits, campanhas, costura/consignação | EP-21..27 | estoque e crédito sem duplicação, opt-in de canais |
| M7 — P2 inteligência | coleções, sazonalidade, metas, previsões, dashboards, regras customizadas | EP-28,29 | previsões explicadas, sem execução financeira automática |
| M8 — QA final e distribuição controlada | E2E completo, carga LAN, segurança, backups, compatibilidade, instalador, release candidate | EP-30 | todos os gates + aprovação de merge e de release em etapas distintas |

**M1–M7 são ondas de integração e homologação, não trabalho sequencial obrigatório.** Em concordância com D62, as frentes podem desenvolver módulos simultaneamente depois da homologação da documentação e dos contratos, utilizando mocks e consumer tests. P2 não impede entregar P0.

## Frentes paralelas
| Frente | Foco | Responsabilidades |
|---|---|---|
| A — Core | EP-01,02,03,11,12 | infraestrutura, contas, segurança, banco, bootstrap e recuperação |
| B — Produto/Estoque | EP-04,05,06,16,20,25 | grade, foto, SKU, estoque e preços |
| C — Operação | EP-07,08,09,10,13 | PDV Retail Fashion, caixa, pagamento, impressão, trocas |
| D — Gestão | EP-14,15,17,19,27 | financeiro, compra, fornecedores, comissões, consignação |
| E — Relacionamento | EP-18,21,22,23,24,26 | CRM, pedidos, provador, kits, presentes, automações opt-in |
| F — BI | EP-28,29 | coleção, metas, previsões, personalização |
| G — UX/QA | EP-30 e interface dos demais | tokens, 48 telas, acessibilidade, Playwright/E2E, gates |

## Entregas por prioridade
**P0 operacional:** instalação assistida, autenticação/RBAC, cadastro de produto com foto/variante, entrada de estoque, preços, PDV com grade visual/filtros/scan/carrinho sticky, pagamentos mistos locais, caixa, recibo não fiscal identificado, impressão, LAN, backup/restore e auditoria. Sem NF-e/NFC-e integrada, que permanece fora do escopo inicial; recibo não fiscal não dispensa obrigações fiscais.

**P1 gestão:** pós-venda, crediário, fornecedores/inteligência, compras/recebimento, finance/DRE, inventário colaborativo e perdas, metas de equipe/comissões, CRM/fidelidade, importador e busca transversal.

**P2 avançado:** reserva/provador, catálogo online, pedidos com retirada/entrega, logística, cartões-presente, kits/embalagens, costura, consignação, campanhas/indicações, preço inteligente, coleções/sazonalidade, BI e personalizações.

## Gates transversais
G0 documentos/UX homologados → G1 lint/build/licenses → G2 contratos e esquemas compatíveis → G3 banco, transações e idempotência → G4 Playwright E2E desktop/PWA → G5 RBAC/LGPD/segurança → G6 carga/recuperação LAN → G7 QA visual UX-RPOS-01 em 7 viewports e acessibilidade → G8 backup/restore/instalação → G9 aprovação explícita humana para **merge** e depois **release**.

## Próximos passos sem implementação antecipada
1. Revisar e aprovar este roadmap, PRD, D4 Retail Fashion, modelos e APIs.
2. Fechar lacunas fiscais, parâmetros de gift card/retorno, hardware e compatibilidade de periféricos.
3. Homologar protótipos visuais responsivos, inclusive estados de falha, antes do código.
4. Autorizar especificamente o início de programação; criar issues detalhadas, owners de módulos, branches e contratos de teste.
5. Desenvolver em paralelo e integrar por M1–M8, com PRs e gates.
6. Somente sob comandos separados do gestor: merge na main e publicação de releases.

**Situação atual:** 65 decisões documentadas; escopo visual atualizado; nenhum módulo implementado, nenhum instalador entregue, nenhuma suíte de aplicação executada, nenhuma release publicada.
