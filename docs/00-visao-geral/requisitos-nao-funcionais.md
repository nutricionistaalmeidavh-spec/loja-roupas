# D0 — Requisitos não funcionais, segurança e custo

Os valores de desempenho são **metas para QA, não resultados medidos**. Os limites poderão ser revisados mediante benchmark no hardware-alvo.

| ID | Área | Critério para homologação |
|---|---|---|
| RNF-01 | Disponibilidade LAN | continuar operando quando internet pública cair, se servidor LAN e rede local estiverem operacionais |
| RNF-02 | Integridade | zero duplicações de venda, pagamento e baixa após retry/conexão instável |
| RNF-03 | Consistência | saldo de estoque e saldo financeiro reconstruíveis de movimentos |
| RNF-04 | Latência | meta p95 até 500 ms para busca por SKU na LAN com base de teste de 50 mil variantes |
| RNF-05 | Checkout | meta p95 até 2 s para confirmação transacional sem depender de periférico externo |
| RNF-06 | Concorrência | simular pelo menos 5 caixas e 10 operadores simultâneos antes de declarar apto para operação inicial |
| RNF-07 | Backup | cópia criptografada, retenção configurável e restauração ensaiada; alvo RPO até 24 h por padrão e RTO até 4 h em hardware de homologação |
| RNF-08 | Segurança | autenticação por sessão, permissões no servidor, limitação de tentativas, CSRF conforme transporte e TLS remoto |
| RNF-09 | Auditoria | autor, momento, origem, motivo e antes/depois para preço, permissões, descontos, ajustes, estornos e configurações |
| RNF-10 | Privacidade | minimização, consentimentos por finalidade, retenção e exportação/eliminação quando permitida |
| RNF-11 | Acessibilidade | WCAG 2.2 AA como meta em fluxos principais, teclado completo, foco e contraste verificáveis |
| RNF-12 | Portabilidade | Docker Compose e volumes documentados em Linux; Electron para desktop e Web/PWA em navegador compatível |
| RNF-13 | Atualização | backup anterior, migração ensaiada, janela de manutenção e recuperação documentada |
| RNF-14 | Observabilidade | health checks, logs estruturados sem segredos/PII desnecessária, métricas e correlação |
| RNF-15 | Licenciamento | licenças de todas as dependências auditadas; nenhum serviço pago obrigatório |
| RNF-16 | Reprodutibilidade | imagens/artefatos com versões fixadas, hashes e manifesto |
| RNF-17 | LGPD | informação clara ao titular, controle de acesso, registros de tratamento e incidentes |
| RNF-18 | Experiência | responsivo mobile-first para PWA, áreas de toque adequadas e tarefas críticas com feedback |
| RNF-19 | Regressão | teste E2E obrigatório dos fluxos PDV/estoque/caixa sempre que afetados |
| RNF-20 | Compatibilidade | contratos versionados, consumidores testados, nenhuma quebra sem migração |

## Falhas e resposta operacional
1. **Sem internet:** operações LAN seguem; integrações externas entram em fila/estado pendente com explicação.
2. **Sem LAN/servidor:** telas indicam indisponibilidade, permitem somente rascunhos locais não confirmados quando aplicável; não aceitam vendas definitivas.
3. **Sem impressora:** venda concluída não é desfeita, documento permanece na fila com tentativas controladas.
4. **Pagamento externo não confirmado:** venda não é concluída como paga; reconciliação manual/autorizada.
5. **Falha após commit e antes da resposta:** cliente consulta o identificador idempotente e não recria venda.

## Privacidade e segurança
- Credenciais protegidas por hash resistente, renovação de sessão e revogação. PIN alterna sessão mediante identidade já autenticada e política restrita; não substitui senha inicial.
- Nenhum armazenamento de PAN/CVV ou autenticação bancária; apenas referência, meio, valor e status.
- Acesso técnico suportado por perfis sem privilégio geral sobre cadastro de consumidores.
- Consentimento separado de base legal para execução de compra e retenção obrigatória; não bloquear venda por recusa de marketing.
- Prazos de retenção precisam de matriz jurídica/local antes de ativar eliminação automática.
- LGPD: solicitações poderão ser limitadas por obrigação legal de conservação, com decisão e justificativa registradas.

## Custos
| Core gratuito e self-hosted | Opcionais explicitamente opt-in |
|---|---|
| PostgreSQL, backend, React, PWA, Electron, Docker Compose, backup local, scripts de diagnóstico, Pix estático/manual, relatório e impressão local | hospedagem gerenciada, provedor Pix dinâmico, adquirente/TEF, SMS/WhatsApp de terceiros, suporte e instalação profissional |
| IA estatística local e consultas SQL | IA cloud comercial somente se ativada com consentimento/termos próprios |

Licença AGPLv3 do código não significa isenção de gastos com hardware, internet, energia ou serviços de terceiros escolhidos pelo cliente.
