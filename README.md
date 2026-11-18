# Loja de Roupas — Retail Fashion POS

Sistema para boutique física inicialmente única, com **desktop Electron, Web/PWA e servidor PostgreSQL canônico em rede local**. Core obrigatório **R$ 0, open source (AGPLv3) e self-hosted**. Serviços pagos são opcionais explícitos, nunca dependências silenciosas.

## Situação em 18/11/2026

- **M0–M3 incorporados à main:** documentação D0–D6, fundação, catálogo/estoque e PDV/caixa transacional.
- **M4–M8 permanecem planejados**, acompanhados nas [issues #7–#11](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues).
- O pagamento por Pix e cartão é **registrado manualmente após conferência externa**; não há cobrança automática, TEF, PSP ou emissão fiscal integrada.
- **Ainda não homologado para clientes. Nenhuma release publicada.** CI verde não equivale a instalador, impressão física, segurança de produção nem backup/restauração validados.

**Comece pelo [status de execução M0–M8](docs/06-roadmap/status-execucao.md), [roadmap final](docs/06-roadmap/roadmap-final.md) e [status técnico](IMPLEMENTATION_STATUS.md).**

## Escopo e especificações

- [65 decisões](docs/00-visao-geral/decisoes-001-065.md), [PRD](docs/00-visao-geral/prd.md) e [rastreabilidade](docs/00-visao-geral/matriz-rastreabilidade.md)
- [Portal D0–D6](docs/README.md), [arquitetura](docs/01-arquitetura/visao-c4.md), [modelo de dados](docs/02-dados/modelo-er.md)
- [OpenAPI D3 (escopo planejado)](docs/03-contratos/openapi/openapi.yaml) e [OpenAPI M3 implementado](docs/03-contratos/openapi/m3-implemented.yaml)
- [Retail Fashion UX-RPOS-01](docs/04-design/direcao-visual-retail-pos.md), [plano de testes](docs/05-qualidade/plano-testes.md)
- [Backlog EP-01 a EP-30](docs/06-roadmap/backlog.md) e [dependências](docs/06-roadmap/dependencias.md)

## Próximos marcos rastreados em issues

| Marco | Situação | Acompanhamento |
|---|---|---|
| M4 — Instalador, impressão, LAN e backup/restore (P0) | Próximo | [#7](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/7) |
| M5 — Pós-venda, finanças, compras, CRM e equipes (P1) | Planejado | [#8](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/8) |
| M6 — Provador, online, entrega, presentes e serviços (P2) | Planejado | [#9](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/9) |
| M7 — Previsões, coleções, planejamento e personalização (P2) | Planejado | [#10](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/10) |
| M8 — QA global e release candidate | Planejado | [#11](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/11) |

**Governança:** branch e PR, contrato versionado, testes e documentação. Merge e release requerem autorizações **separadas**. Nenhuma publicação automática.
