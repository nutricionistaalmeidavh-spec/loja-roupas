# D6 — Backlog executável, P0/P1/P2 e frentes paralelas

Todos os módulos podem **evoluir em paralelo** por contratos versionados e gates de CI, com M0–M3 já incorporados à main. O backlog preserva os 30 épicos; integração e homologação são etapas distintas. P0/P1/P2 são ondas de integração/homologação, **não** autorização para ignorar módulos ou construir sem dependências. Cada épico exige branch, PR, contrato e QA.

| Épico | Frente | Prioridade de integração | Escopo | Pré-requisitos | Gate de aceite |
|---|---|---|---|---|---|
| EP-01 | Fundação | P0 | estrutura monorepo, pnpm, Turborepo, licença | D0-D6 homologados | build reprodutível e dependências auditadas |
| EP-02 | Infra | P0 | PostgreSQL, Docker Compose, health | EP-01 | LAN/WAN teste |
| EP-03 | Identidade | P0 | login, RBAC, sessão, PIN e dispositivos | EP-02 | negar privilégios/loja errada |
| EP-04 | Catálogo | P0 | produto, variação, grade, SKU, fotos e thumbnails locais, categorias e variantes selecionáveis | EP-02, EP-03 | SKU canônico, fotos com fallback e catálogo navegável |
| EP-05 | Estoque | P0 | movimento, saldo, reserva e contagem inicial | EP-04 | concorrência sem oversell |
| EP-06 | Preço | P0 | preço, desconto, publicação mínima e cotação de variante para cards/carrinho | EP-04 | snapshot de preço vigente no servidor |
| EP-07 | Caixa | P0 | abertura, movimentos e fechamento | EP-03 | conciliação |
| EP-08 | Pagamentos | P0 | dinheiro, Pix manual, cartão externo, split | EP-07 | sem PAN/CVV e idempotente |
| EP-09 | PDV Retail Fashion | P0 | grade fotográfica 3 colunas, categorias, icon rail, scanner, variantes no card, cart sidebar/drawer, pagamento por etapas, suspensão | EP-03..08; UX-RPOS-01 | QA-UX-01..12 + venda ACID e idempotente |
| EP-10 | Impressão | P0 | etiqueta/recibo e fila local | EP-04, EP-09 | reimpressão sem venda extra |
| EP-11 | Instalador | P0 | wizard, bootstrap, diagnóstico e update assistido | EP-02, EP-03 | instalação sem .env manual |
| EP-12 | Resiliência | P0 | backup/restore, outbox, auditoria | EP-02, EP-09 | recuperar após falha |
| EP-13 | Pós-venda | P1 | trocas, devoluções, crédito/crediário | EP-09 | compensação consistente |
| EP-14 | Financeiro | P1 | contas, DRE, previsão, banco importado | EP-07..09 | soma e rastreio |
| EP-15 | Compras | P1 | fornecedores, pedido, recebimento, score | EP-04, EP-05 | receber sem dupla baixa |
| EP-16 | Inventário | P1 | contagem colaborativa, perda, qualidade | EP-05 | ajuste aprovado |
| EP-17 | Pessoas | P1 | vendedor, metas, comissão | EP-03, EP-09 | comissão reproduzível |
| EP-18 | CRM | P1 | cliente, consentimento, fidelidade | EP-03, EP-09 | permissão e LGPD |
| EP-19 | Importação | P1 | planilha, mapeamento, prévia e log | EP-04, EP-15 | sem parcial silencioso |
| EP-20 | Busca | P1 | FTS, trigrama, scanner e filtros | EP-04, EP-18 | respeito a permissões |
| EP-21 | Reservas/provador | P2 | atendimento PWA, pré-venda e sinal | EP-05, EP-18 | liberar reserva uma vez |
| EP-22 | Online | P2 | catálogo público, pedido e checkout | EP-04, EP-05, EP-06 | sem oversell |
| EP-23 | Logística | P2 | entrega, retirada, prova | EP-22 | estados corretos |
| EP-24 | Presentes | P2 | gift card, kits, embalagem | EP-04, EP-09, EP-14 | ledger/estoque íntegros |
| EP-25 | Promoções | P2 | campanhas, versões, etiquetas | EP-06, EP-10 | publicação autorizada |
| EP-26 | Marketing | P2 | automações, indicações, consentimento | EP-18 | opt-in em todos os canais |
| EP-27 | Serviços | P2 | ajustes/costura e consignação | EP-04, EP-15 | propriedade e custos rastreáveis |
| EP-28 | Inteligência | P2 | coleções, metas, previsões, scores | EP-14, EP-15, EP-25 | explicabilidade |
| EP-29 | Personalização | P2 | regras/fields e widgets | EP-03, EP-04 | permissões e compatibilidade |
| EP-30 | QA e Release | contínuo | contratos, Playwright E2E/visual, acessibilidade, security e backup | todas as frentes | QA-UX-01..12 + gates G0–G9, liberação humana |

## Entregáveis por épico
Cada EP é quebrado em: contrato e schema → testes de contrato → migração → serviços do domínio → interface desktop/PWA → integração → E2E + segurança → documentação → evidências de QA → PR para revisão. A documentação D0–D6 precedeu a implementação M1–M3; qualquer evolução deverá respeitar contratos, testes e autorização de merge/release.

## Convenção de issues
Título: [EP-09][RF-PDV-01] Confirmar venda idempotente. Corpo: decisão D03/D35/D37, contexto, história, contrato afetado, entidades, permissão, estados, critérios Given/When/Then, testes positivos/negativos, riscos e dependências. Labels propostas: ep:09, prioridade:p0, dominio:pdv, tipo:contrato|implementacao|qa, status:blocked|ready|review.

## Marcos de execução sem datas artificiais

- M0–M3: na main via PRs #1–#6, CI verde de catálogo/caixa. **Não equivale a P0 homologado.**
- M4 P0: [issue #7](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/7) — instalador, impressoras/filas, backup/restore, rede LAN, segurança e QA real.
- M5 P1: [issue #8](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/8) — EP-13..20, inclusive financeiro, compras, CRM e crediário.
- M6 P2: [issue #9](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/9) — EP-21..27.
- M7 P2: [issue #10](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/10) — EP-28/29.
- M8: [issue #11](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/11) — EP-30, QA transversal e release candidate.

Consulte a [tabela de status e pendências](status-execucao.md); EP-03, EP-05, EP-06 e EP-09 possuem requisitos pendentes de homologação além das implementações já entregues.

## Direção aprovada do PDV no P0
**UX-RPOS-01** altera EP-04, EP-06, EP-09 e EP-30 sem criar uma decisão 66 nem exigir novas dependências pagas. O PDV será entregue já com catálogo fotográfico, variantes escolhidas no próprio cartão, rail compacto e carrinho sticky/drawer. [Roadmap final](roadmap-final.md) e [especificação D4](../04-design/direcao-visual-retail-pos.md).
