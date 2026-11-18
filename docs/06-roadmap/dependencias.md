# D6 — Dependências, paralelismo e gestão de riscos

## Grafo de dependência de integração
~~~mermaid
flowchart TD
  A[EP01 Fundação] --> B[EP02 Infra]
  B --> C[EP03 Identidade]
  B --> D[EP04 Catálogo]
  D --> E[EP05 Estoque]
  D --> F[EP06 Preços]
  C --> G[EP07 Caixa]
  G --> H[EP08 Pagamentos]
  E --> I[EP09 PDV]
  F --> I
  H --> I
  I --> J[EP12 Resiliência]
  I --> K[EP13 Pós-venda]
  I --> L[EP14 Financeiro]
  I --> M[EP18 CRM]
  E --> N[EP15 Compras]
  M --> O[EP26 Marketing]
  D --> P[EP22 Online]
  E --> P
  P --> Q[EP23 Logística]
  L --> R[EP28 Inteligência]
  N --> R
~~~

## Paralelismo real
- Frente A: plataforma, identidade e deploy podem avançar a partir de contratos provisórios estáveis.
- Frente B: catálogo, estoque e preços evoluem em paralelo com fixtures pactuadas.
- Frente C: PDV, caixa, pagamentos e impressão usam mocks de contratos publicados; integração real só após invariantes.
- Frente D: compras, financeiro, CRM, serviços e marketing usam IDs/schemas canônicos e contratos versionados.
- Frente E: Web/PWA, design system, UX e testes de jornada trabalham contra OpenAPI e cenários de fixture.
- Frente F: qualidade/performance/segurança acompanha cada PR; não valida só ao final.

## Política de merge e integração
1. Contrato alterado → PR próprio de contrato → revisão de produtor/consumidores.
2. Branch por módulo; PR de domínio só pode usar nova versão de contrato previamente revisada.
3. Migração concorrente é serializada e testada sobre a cabeça atual da branch de integração.
4. Gate do PR inclui testes de limites de módulo, integração, autorização, idempotência e E2E afetados.
5. Main não recebe merge sem autorização explícita.
6. Release manual e separada da decisão de merge.

## Registro de riscos
| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Sobrescrever estoque por concorrência | alta | crítico | locks, constraints e testes de corrida |
| API incompatível entre equipes | alta | alto | contract-first e consumer tests |
| Escopo de 65 decisões prolongar integração | alta | alto | roadmap com gates, fixtures e protótipos por fluxo |
| Internet confundida com LAN | média | alto | laboratório WAN-off e LAN-off |
| Emissão não fiscal interpretada como cumprimento fiscal | média | crítico | aviso e validação fiscal externa do cliente |
| Dependência paga inadvertida | média | alto | SBOM/manifesto de integrações e teste sem internet |
| Atualização danificar dados | média | crítico | migração ensaiada + backup restore |
| Perda de segredo ou vazamento de cliente | média | crítico | RBAC, criptografia, revisão de logs |
| Imprimir duas vezes | média | médio | job_id estável e política explícita de reimpressão |
| Forecast interpretado como garantia | média | médio | incerteza e premissas no painel |
| Falta de periférico compatível | média | alto | matriz de hardware, agent opcional, mock QA |
| Custos de hardware subestimados | média | médio | requisitos mínimos via benchmark e checklist de capacidade |

## Responsabilidades
O domínio é dono do schema e invariantes; contratos são co-revisados; QA define provas; arquitetura revisa mudanças de fronteira; proprietário autoriza prioridades, merge e publicação. Sem estimativa fixa de prazo/esforço até medir tamanho da equipe, acesso a hardware e volume esperado.

## Dependências de UX-RPOS-01
- EP-04 fornece fotos/thumbnail local, categorias, variant_id e SKU para ProductCard; EP-05 devolve disponibilidade canônica.
- EP-06 fornece preço/vigência/cotação; EP-09 compõe grade, cart e checkout usando a mesma API/estado.
- UX e contrato podem progredir em paralelo ao backend; integração funcional depende de API aprovada, não de mock fictício.
- EP-30 deve validar QA-UX-01..12; performance de imagem não pode degradar leitura de scanner.
- Os épicos P1/P2 podem ser desenvolvidos em paralelo, mas não bloquear o fechamento do P0.
