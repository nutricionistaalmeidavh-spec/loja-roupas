# D5 — Critérios de aceite por release e severidade

## DoR — Definition of Ready (antes do código)
- Decisão Dnn e RF explicitados, com dono de domínio e política de segurança.
- Contrato HTTP/eventos, esquema e comportamento sob concorrência descritos.
- Wireframe, estados de erro, mensagens e acessibilidade definidos.
- Critérios de aceite positivos/negativos, dados de teste e dependências identificados.
- Licenças compatíveis e nenhuma dependência paga silenciosa.
- Gestor revisou e autorizou explicitamente iniciar implementação.

## DoD — Definition of Done (por incremento)
- Código dentro do domínio correto, sem alteração direta de tabela alheia.
- Migração testada, reversibilidade ou restore documentados.
- Testes unitários, integração, contrato e E2E afetados passando.
- Autorização, auditoria, idempotência, erro e observabilidade atendidos.
- README/API/ADR/wireframe atualizados quando houve alteração.
- Sem secrets, credenciais ou dados reais no PR.
- PR revisado; merge apenas depois de autorização explícita.

## Critérios P0 — primeira versão operacional
- Installer/servidor LAN funcional sem conta externa.
- Cadastro de loja, operador e papéis com proteção.
- Produto com tamanhos/cores e SKU, entrada de estoque, consulta em PDV.
- Caixa abre, venda mista confirma, estoque baixa uma vez, recibo não fiscal entra na fila.
- Caixa fecha e relatórios reconstituem as mesmas vendas.
- Rede WAN desligada não impede venda LAN; queda de LAN bloqueia confirmação.
- Backup criptografado e restore ensaiado.
- Usuário entende que recibo não fiscal não substitui exigência legal.
- Zero P0/P1; resultado de performance documentado.

## Critérios P1 — gestão estendida
Compras, fornecedores, recebimento parcial, financeiro avançado, devolução/troca, crediário, CRM, comissões, contagem colaborativa, etiquetagem e importação auditável, cada qual com fluxos de autorização e reconciliação.

## Critérios P2 — inteligência e experiências complementares
Reservas, provadores, catálogo online, pedidos/entrega, campanhas, indicação, gift card, kits, consignação, ajustes, coleções, recomendações e metas; previsão explicável e opt-in explícito para integrações externas.

**Importante:** apesar de P0/P1/P2 como sequência de integração/release, o desenvolvimento de todos os módulos pode ocorrer em paralelo (D62); disponibilidade final depende dos gates. Nenhum recurso P2 é pressuposto entregue no P0.

## Política de bloqueio
- P0: perda/vazamento de dados, duplicidade financeira/estoque, autorização quebrada, falha de restauração e checkout inacessível → bloqueia integração e release.
- P1: fluxo operacional crítico quebrado, divergência de preço, indisponibilidade de módulo obrigatório, regressão relevante → bloqueia release.
- P2: falha não crítica com workaround validado → documentar, priorizar, autorização expressa se for incluída.
- Nenhum erro é reclassificado apenas para liberar build.
