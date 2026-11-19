# Roadmap final — Loja de Roupas

**Base:** 65 decisões encerradas + refinamento UX-RPOS-01. **Status em 18/11/2026:** código de M0–M3 incorporado à `main`, CI de M2/M3 verde; sem release e ainda sem homologação comercial. Ver [situação executável M0–M8](status-execucao.md). Sem datas de conclusão artificiais.

## Princípios
Core **R$ 0, open source (AGPLv3 prevista) e self-hosted**; integrações pagas exclusivamente opcionais, explicitamente autorizadas. Inicialmente loja física única, modelo multi-filial-ready; React/TypeScript + Electron + Web/PWA; monólito modular com PostgreSQL autoritativo e API REST/OpenAPI, WebSocket/outbox; LAN opera sem internet, porém não sem servidor local. Desenvolvimento paralelo de todos os módulos, contratos versionados antes de código, validação por gates. Merge na main e release sempre exigem autorização independente.

**Direção visual do PDV P0:** [Retail Fashion POS — UX-RPOS-01](../04-design/direcao-visual-retail-pos.md). Catálogo fotográfico em grade 3 colunas desktop, menu de ícones compacto, filtros de categoria, seleção cor/tamanho/SKU no card, scanner e busca, carrinho persistente lateral desktop e drawer mobile, etapa de pagamento separada. Branco/cinza/preto dominam o PDV; café/creme são acentos. Desenho original, sem cópia de assets de Dribbble.

## Acompanhamento de execução (não confundir código integrado com produto homologado)

| Marco | Situação confirmada | Próxima ação |
|---|---|---|
| M0 — Documentos | Incorporados à main via PR #1 | Validar aspectos fiscais e UX finais |
| M1 — Fundação | Código integrado via PR #2 | Hardening, PIN/dispositivos e distribuição M4 |
| M2 — Catálogo/estoque | Código e testes integrados via PRs #3–#5 | Inventário colaborativo, hardware e carga |
| M3 — PDV/caixa | Código integrado via PR #6; [5 E2E PASS](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/actions/runs/44326485213) | Impressoras, LAN/backup, descontos avançados |
| **M4 — P0 operacional** | **Parcial em PR** | [Issue #7](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/7): instalador, impressão, resiliência, QA LAN |
| M5 — Gestão P1 | Parcial em PR | [Issue #8](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/8) |
| M6 — Experiências P2 | Parcial em PR | [Issue #9](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/9) |
| M7 — Inteligência P2 | Planejado | [Issue #10](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/10) |
| M8 — QA global e RC | Planejado | [Issue #11](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/11) |

**Os requisitos integrais de cada marco continuam como gates de homologação.** M0–M3 foram incorporados à main, mas hardware real, resiliência, UX, segurança de produção e revisão legal/fiscal ainda não foram plenamente homologados. Não há release publicada.

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

## Próximos passos executáveis (M4–M8)

1. **M4 P0:** [issue #7](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/7) — instalador guiado, fila de impressão, backup/restauração, rede LAN, segurança e QA WAN-off/LAN-off.
2. **M5 Gestão P1:** [issue #8](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/8) — pós-venda, crediário, finanças/DRE, fornecedores/compras, inventário, equipe, CRM e importação/busca.
3. **M6 Experiências P2:** [issue #9](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/9) — provador, reservas, catálogo, pedidos, entregas, presentes, costura/consignação e marketing consentido.
4. **M7 Inteligência P2:** [issue #10](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/10) — metas, planejamento, sazonalidade, previsões explicáveis e personalização.
5. **M8 QA/RC:** [issue #11](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/11) — testes globais, segurança, perfis/hardware, restore, acessibilidade e candidata à release sem publicar.
6. **Rastreabilidade obrigatória:** em cada PR registrar Dnn/EP-nn, contrato versionado, testes, documentação, evidência e atualização do [status de execução](status-execucao.md).

**Autorização de merge M0–M3 não autoriza release, nem merges futuros.** Core obrigatório gratuito/open source/self-hosted; serviços pagos opt-in, nunca necessários para funcionar.
