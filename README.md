# Loja de Roupas — Retail Fashion POS

Sistema para boutique física inicialmente única, com **desktop Electron, Web/PWA e servidor PostgreSQL canônico em rede local**. Core obrigatório **R$ 0, open source (AGPLv3) e self-hosted**. Serviços pagos são opcionais explícitos, nunca dependências silenciosas.

## Situação e validação em 27/11/2026

- **M0–M3 incorporados à main:** documentação D0–D6, fundação, catálogo/estoque e PDV/caixa transacional.
- **M4–M8 têm implementações parciais integradas**, mas a homologação em hardware e operação real ainda está pendente. Consulte [status de execução](docs/06-roadmap/status-execucao.md).
- O pagamento por Pix e cartão é **registrado manualmente após conferência externa**; não há cobrança automática, TEF, PSP ou emissão fiscal integrada.
- **Edição física Windows v0.2.7** publicada como pré-release: [download](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/releases/tag/loja-fisica-v0.2.7). Inclui P1 (PR #42 incorporada), atualizador próprio, ícone e atalhos. Sem homologação de periféricos reais.
- **Edição comercial (com ativação)** preparada para venda: instalador, dados e atualizações separados da edição livre. Veja [docs/comercial](docs/comercial/README.md).

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
| M4 — Instalador, impressão, LAN e backup/restore (P0) | Parcial; edição física v0.2.7 publicada; edição comercial em build | [#7](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/7) |
| M5 — Pós-venda, finanças, compras, CRM e equipes (P1) | Parcial; PR #42 incorporada | [#8](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/8) |
| M6 — Provador, online, entrega, presentes e serviços (P2) | Planejado | [#9](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/9) |
| M7 — Previsões, coleções, planejamento e personalização (P2) | Planejado | [#10](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/10) |
| M8 — QA global e release candidate | Planejado | [#11](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues/11) |

**Governança:** branch e PR, migrações versionadas, testes e documentação. Não haverá publicação de release sem validação e autorização explícita do proprietário.

## Instalação Windows autônoma e primeiro acesso

O instalador Windows x64 inclui a aplicação Electron, PostgreSQL portátil e API local. Ao abrir pela primeira vez, o próprio aplicativo prepara o banco, pede nome da loja e credenciais de administrador e abre o sistema. Depois do login, o tour apresenta os módulos permitidos e pode ser reaberto pelo botão **Ajuda · Tour**. Não exige Docker, hospedagem nem assinatura. Os dados residem fora da pasta do programa e permanecem após desinstalar (backup obrigatório antes de migração). Para computadores adicionais, conecte explicitamente ao servidor LAN existente.

**Atenção:** esta implementação ainda exige testes físicos em Windows, backup/restauração e periféricos para homologação comercial. A base fica disponível em 127.0.0.1 na instalação de computador único, não exposta automaticamente à rede.

## Primeiro acesso sem serviços pagos
No computador servidor (Linux com Docker Compose, Node 22+ e OpenSSL), execute `bash scripts/install-lan.sh`. O assistente de terminal solicita o endereço local, cria credenciais de banco, migra a base, solicita loja e administrador e verifica `/v1/ready`. O endereço padrão `127.0.0.1` só permite acesso no próprio servidor; uso multioperador exige configuração da LAN e revisão de segurança. Não pressupõe conta em nuvem, API paga nem assinatura.

**Pendências para homologação:** impressoras e leitores reais, Windows instalado na loja, fluxo WAN-off/LAN-on, restauração com fotos, disponibilidade de rede, segurança e revisão de acessibilidade por teclado/leitor de tela. CI verde não é evidência desses requisitos. Não publicar release antes da homologação.
