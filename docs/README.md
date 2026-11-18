# D0–D6: pacote documental

Versão: 0.1.0 · Data-base: 2026-11-17 · Status: **pronto para revisão, não homologado**.

| Fase | Documento principal | Conteúdo |
|---|---|---|
| D0 | [PRD](00-visao-geral/prd.md), [65 decisões](00-visao-geral/decisoes-001-065.md), [matriz](00-visao-geral/matriz-rastreabilidade.md), [RNFs](00-visao-geral/requisitos-nao-funcionais.md) | O quê e por quê |
| D1 | [C4](01-arquitetura/visao-c4.md), [módulos](01-arquitetura/modulos-e-dependencias.md), [implantação](01-arquitetura/implantacao-seguranca.md) e ADRs | Como se organiza |
| D2 | [ER](02-dados/modelo-er.md), [dicionário](02-dados/dicionario.md), [transações](02-dados/transacoes-migracoes.md) | Dados e invariantes |
| D3 | [OpenAPI](03-contratos/openapi/openapi.yaml), [73 operações](03-contratos/catalogo-de-operacoes.md), [eventos](03-contratos/eventos.md), [autorização](03-contratos/autorizacao-erros-idempotencia.md) | Interfaces e integração |
| D4 | [Design system](04-design/design-system.md), [mockups estáticos](04-design/mockups-estaticos.md), [jornadas e wireframes](04-design/jornadas-e-wireframes.md), [catálogo de telas](04-design/catalogo-de-telas.md) | UX/UI e interação |
| D5 | [Plano QA](05-qualidade/plano-testes.md), [critérios](05-qualidade/criterios-aceite.md), [matriz de testes](05-qualidade/casos-de-teste.md) | Prova de qualidade |
| D6 | [Backlog](06-roadmap/backlog.md), [dependências](06-roadmap/dependencias.md), [prontidão](06-roadmap/criterios-de-prontidao.md) | Execução e aprovação |

### Definições e limites
- Decisões 1–65 representam **requisitos aprovados**, não implementação concluída.
- Regras técnicas detalhadas aqui são **propostas de execução** para homologar no PR. Sempre que as 65 decisões não especificam comportamento, a documentação o identifica como premissa ou ponto de validação.
- Nenhum serviço pago pode ser requisito do core. Custos de equipamento, energia ou infraestrutura própria não são anulados pela licença gratuita.
- Emissão fiscal não está no core definido; recibo não fiscal **não substitui** documento fiscal legalmente devido. Integração externa será escopo futuro explícito.
- Protótipos D4 aqui são jornadas e wireframes textuais revisáveis; maquetes navegáveis/visuais finais dependem de homologação de design. Não são apresentados como já implementados.
- Três estados de aprovação: **documentado**, **revisado**, **homologado**. Este pacote só afirma o primeiro.
