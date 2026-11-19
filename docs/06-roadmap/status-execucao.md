# Acompanhamento de execução — Loja de Roupas

**Atualizado em:** 2026-11-19 · **Fonte de verdade:** `main` + [roadmap final](roadmap-final.md) + [backlog EP-01..EP-30](backlog.md) + [decisões D01–D65](../00-visao-geral/decisoes-001-065.md).

## Estado por marco

| Marco | Integração de código | Homologação para produção | Rastreio |
|---|---|---|---|
| M0 — Documentação D0–D6 | Incorporada à `main` | Validação legal/fiscal e UX final ainda pendentes | [PR #1](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/pull/1) |
| M1 — Fundação | Incorporada à `main`; monorepo, PostgreSQL, migrações, autenticação inicial e RBAC | PIN, dispositivos, hardening e empacotamento pendentes | [PR #2](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/pull/2) |
| M2 — Catálogo/estoque | Incorporada à `main`; grades/SKUs, preços, fotos + thumbnails, estoque, edição, auditoria, paginação | Operação em hardware, cenários de carga e inventário colaborativo pendentes | [PRs #3–#5](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/pull/5) |
| M3 — PDV/caixa | Incorporada à `main`; cotação, venda transacional, carrinho suspenso, caixa e recebimentos manuais mistos | Impressão periférica e autorização de descontos avançados pendentes | [PR #6](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/pull/6) |
| M4 — P0 operacional | Parcial na `main` via PR #13 · instalação LAN, cliente portátil, impressão e backup | Homologação física, modos de rede, PWA em aparelhos, spool e hardening pendentes | [Issue #7](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/7) |
| M5 — Gestão P1 | Parcial na `main` via PR #13 · fornecedores, devolução integral em dinheiro e resumo por dia | Integração financeira, pós-venda, compras, equipes, CRM e LGPD | [Issue #8](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/8) |
| M6 — Experiências P2 | Parcial na `main` via PR #13 · vitrine, reserva interna e retirada paga no caixa | Provador, pagamento online, entregas, kits/gift cards e serviços | [Issue #9](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/9) |
| M7 — Inteligência P2 | Painel, metas, coleções, previsão, regras, score de fornecedores, 36 meses e campos de produto em PR | Validação comercial com histórico da loja pendente | [Issue #10](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/10) |
| M8 — QA e RC | Esteira de QA, instaladores Debian e Windows e testes de periféricos em PR | Homologação física, compatibilidade de campo e revisão geral de segurança pendentes | [Issue #11](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/11) |

**Atenção:** "incorporado à main" significa código integrado e CI verde para os fluxos cobertos, **não** homologação comercial/operacional e **não** release. Nenhuma release foi publicada na incorporação de M0–M3.

[Detalhes da entrega parcial, instalação e pendências](../07-implementacao/m4-m6-operacao-gestao-vitrine.md).

## Evidências de integração

| Fase | Referências | Limites dos testes |
|---|---|---|
| M1 | [PR #2](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/pull/2) | CI de autenticação, tipos, migração e domínio |
| M2 API | [PR #3](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/pull/3) | PostgreSQL real, idempotência, isolamento por loja |
| M2 UI | [PR #4](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/pull/4) | Login, SKU, recebimento; Playwright desktop e mobile |
| M2 final | [PR #5](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/pull/5), [CI](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/actions/runs/44325106196) | Edição, grade, preços, imagem/thumbnail e estoque |
| M3 final | [PR #6](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/pull/6), [CI final](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/actions/runs/44326485213) | **5/5 E2E Playwright PASS** com PostgreSQL: catálogo/estoque, edição/foto, grade, venda caixa/Pix manual+dinheiro/fechamento, suspensão/retomada |

A CI acima usa banco efêmero e navegador automatizado. **Não confirma** operação em loja real, disponibilidade em rede, compatibilidade de impressoras, segurança de produção ou implantação em clientes.

## Próximo trabalho: M4 — P0 operacional (issue #7)

- [ ] **M4.1 Instalador/servidor:** wizard gratuito que instala/prepara serviço PostgreSQL/Docker Compose, cria usuário e permite configuração guiada, health check, diagnóstico e atualização autorizada; empacotar Electron com documentação de suporte.
- [ ] **M4.2 Rede:** acesso multioperador LAN, web/PWA via servidor, operação com WAN desconectada, sem baixar estoque quando PostgreSQL LAN está inacessível; HTTPS/VPN apenas opção explícita para acesso externo.
- [ ] **M4.3 Impressão:** fila central de jobs idempotentes, comprovante não fiscal, etiqueta Code128 por SKU, reimpressão auditada, impressoras 58/80 mm e agente local opcional.
- [ ] **M4.4 Resiliência:** backup PostgreSQL **incluindo fotos** e histórico, cifrado, restauração e teste de integridade, estratégia de retenção, rollback de migração e atualizações assistidas.
- [ ] **M4.5 Segurança:** sessões e permissões granulares, PIN de troca de operador, dispositivos, isolamento por loja, auditoria, configuração de rede e verificação de dependências/licenças.
- [ ] **M4.6 QA P0:** Playwright em desktop/PWA, teste de carga/concor­rência, acessibilidade e 7 viewports, scanner/impressoras reais, provas WAN-off/LAN-on e LAN-off, backup/restore documentado; zero falhas P0/P1.

**Gate:** o sistema só será descrito como pronto para loja depois de evidências dos itens acima, revisão de UX, aspectos legais/fiscais, testes em hardware real e autorização explícita do proprietário.

## M5 a M8 — escopo ainda comprometido

| Fase | Épicos | Funções completas preservadas |
|---|---|---|
| **M5 Gestão** | EP-13..20 | devolução/troca, créditos e crediário, financeiro e DRE, compras/fornecedores/reposição, contagem colaborativa e perdas, vendedores/metas/comissões, CRM/fidelidade com LGPD, importação assistida e busca |
| **M6 Experiências** | EP-21..27 | provador/reservas/pré-vendas, vitrine digital, pedidos para retirada/entrega, logística, gift cards, kits/embalagens, preços/promos publicados, marketing/indicação opt-in, costura e consignação |
| **M7 Inteligência** | EP-28..29 | coleções, sazonalidade, previsão com incerteza, metas/planejamento comercial, performance de fornecedores, dashboards e personalização por regras |
| **M8 Homologação** | EP-30 | contratos, E2E global, segurança/LGPD, CI, testes de carga, periféricos, restauro, distribuição e RC; publicação manual separada |

**Paralelismo D62:** novas frentes podem evoluir em paralelo por contratos versionados. P0/P1/P2 determinam ordem de **homologação**, não proíbem engenharia paralela. Nunca alterar dados canônicos com sincronização independente por dispositivo.

## Diferença entre o código existente e a visão completa

- O **M3 confirma somente dinheiro e recebimentos Pix/cartão atestados manualmente**. Não existe consulta automática ao banco, TEF, captura de cartão ou processamento do PSP. Serviços pagos podem existir no futuro apenas como escolha explícita, sem dependência do core.
- O comprovante de venda é **NÃO FISCAL**; não substitui NFC-e/NF-e ou obrigação fiscal aplicável. Fiscalização e parametrização exigem revisão profissional/local.
- Scanner por teclado/SKU já tem fluxo Web, mas integração periférica e impressão física são gates M4.
- Trocas, descontos com alçada complexa, parcelamento/crediário, CRM e financeiro avançado pertencem a M5/P1 ou módulos posteriores; não registrar como concluídos.
- O desktop Electron tem pacotes portáteis e instaladores Debian amd64 e Windows x64 em validação no PR #16. O backend precisa do PostgreSQL local/LAN. A aplicação não deve confirmar venda isolada offline.
- A suíte de CI automatizada não equivale a homologação de uma instalação no cliente.

## Regras obrigatórias de governança

1. Uma issue por marco: [M4](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/7), [M5](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/8), [M6](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/9), [M7](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/10), [M8](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/11); subdividir por épico, manter vínculo Dnn/EP-nn/QA.
2. Alteração funcional: contrato/OpenAPI, migração versionada, testes de regressão, PR, gates CI, documentação e evidência.
3. **Merge e release são aprovações separadas.** A incorporação de M0–M3 autorizada em 18/11/2026 não autoriza publicação de release.
4. Núcleo **R$0**, licença AGPLv3, open source, self-hosted. Infraestrutura/hardware do próprio usuário podem ter custo; serviços comerciais jamais dependências ocultas.
5. Atualizar **este documento, roadmap-final.md e IMPLEMENTATION_STATUS.md** em cada encerramento de marco, indicando implementado, verificado, pendente e não homologado.
