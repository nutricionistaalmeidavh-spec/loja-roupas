# Loja de Roupas — especificação de produto e arquitetura

Sistema de loja de roupas em planejamento. Escopo: boutique física inicial, desktop Electron, Web/PWA, backend modular TypeScript, PostgreSQL central, operação LAN sem internet. **Núcleo obrigatório gratuito (R$ 0), open source e self-hosted.**

**Estado:** documentação D0–D6 proposta para revisão; nenhuma implementação, merge ou release autorizada.

## Índice
- [Portal da documentação](docs/README.md)
- [PRD](docs/00-visao-geral/prd.md)
- [Decisões 1–65](docs/00-visao-geral/decisoes-001-065.md)
- [Rastreabilidade](docs/00-visao-geral/matriz-rastreabilidade.md)
- [Arquitetura](docs/01-arquitetura/visao-c4.md)
- [Dados](docs/02-dados/modelo-er.md)
- [Contrato HTTP](docs/03-contratos/openapi/openapi.yaml)
- [Experiência](docs/04-design/jornadas-e-wireframes.md)
- [Plano de qualidade](docs/05-qualidade/plano-testes.md)
- [Roadmap final](docs/06-roadmap/roadmap-final.md)
- [Direção visual Retail Fashion POS](docs/04-design/direcao-visual-retail-pos.md)
- [Backlog](docs/06-roadmap/backlog.md)

## Regras de governança
Mudanças devem ser apresentadas em branch e PR. Nada é incorporado à main nem publicado sem aprovação explícita. Os arquivos em docs são **especificações**, não alegações de funcionalidades existentes.
