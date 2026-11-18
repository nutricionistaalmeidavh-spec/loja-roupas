# M3 — PDV, caixa e recebimentos manuais (implementação)

**Estado:** código e integração PostgreSQL no PR #6, sobre o M2 do PR #5. Validação automatizada no GitHub Actions; **sem merge e sem release**.

## Jornada da venda

1. Gestor/operador autorizado entra na loja e abre `CAIXA-01`, com valor inicial contado.
2. Seleciona as variações por SKU, cor e tamanho, com preços e saldos consultados na API.
3. Pode suspender o carrinho no PostgreSQL e retomá-lo no mesmo caixa, sem reservar/baixar estoque; a confirmação revalida preços e disponibilidade.
4. Na etapa de pagamento, a API recalcula o total; a interface permite dinheiro, Pix **confirmado manualmente** e cartão **registrado de maquininha externa**. O operador deve atestar cada recebimento e fornecer referência do pagamento externo.
5. `POST /v1/sales` recebe Idempotency-Key, preços esperados e pagamentos confirmados. Uma única transação do PostgreSQL bloqueia o caixa e as variantes, compara a revisão do preço, verifica estoque, grava venda, linhas e pagamentos, registra saídas de estoque, outbox e auditoria, e calcula troco exclusivamente de dinheiro.
6. Retentativa com a mesma chave e conteúdo devolve o resultado sem gerar segunda venda. Mudança de conteúdo com mesma chave resulta em conflito.
7. O operador pode consultar a venda e imprimir comprovante **NÃO FISCAL**.
8. A conferência de caixa calcula saldo esperado = abertura + entradas em dinheiro - troco + suprimentos - sangrias. A divergência exige justificativa.

## Contratos operacionais disponíveis
- `GET /v1/cash-sessions/current?terminal=CAIXA-01`
- `POST /v1/cash-sessions`
- `POST /v1/cash-sessions/{id}/movements`
- `POST /v1/cash-sessions/{id}/close`
- `POST /v1/sales/quotes`
- `POST /v1/sales`
- `GET /v1/sales/{id}`
- `GET /v1/sales/{id}/receipt`
- `GET /v1/sales/drafts`
- `POST /v1/sales/drafts`
- `POST /v1/sales/drafts/{id}/resume`

Escritas exigem sessão autorizada, `X-Store-Id` e `Idempotency-Key`; cotação e consultas exigem sessão/autorização. O esquema OpenAPI de implementação está em `docs/03-contratos/openapi/m3-implemented.yaml`. O OpenAPI D3 original inclui operações planejadas, não necessariamente disponíveis nesta fase.

## Escopo, limites e segurança

- Core R$0, código open source, execução local/LAN e PostgreSQL self-hosted.
- **Não há confirmação bancária automática, TEF integrado, processamento de cartão nem consulta ao PSP.** A marcação de Pix/cartão é declaração manual do operador. Integrações financeiras futuras são opcionais explícitas.
- O sistema não recebe nem armazena número de cartão, CVV ou credenciais bancárias.
- Comprovante é **não fiscal**; não substitui NFC-e/NF-e, Cupom Fiscal ou obrigações tributárias exigíveis.
- Não há devolução, estorno, crediário, descontos gerenciais automatizados ou integração fiscal nesta entrega (planejados para evolução).
- Cada terminal admite no máximo uma sessão de caixa aberta por loja. Operadores não gestores só operam seu próprio caixa.
- A sessão da interface é mantida em memória e não persiste após recarregar a página.
- Sem servidor PostgreSQL LAN, o checkout deve falhar fechado; não há vendas confirmadas offline.
- Limites de homologação: revisão humana de UX/acessibilidade, impressão em periféricos reais, recuperação/backup e instalador antes de comercializar.

## Qualidade

Testes Node de integração com PostgreSQL conferem venda idempotente, baixa única, conflito por saldo, pagamento externo sem confirmação, troco, fechamento de caixa e suspensão. Playwright valida abertura, catálogo, recebimento, venda com Pix manual/dinheiro, impressão não fiscal e suspensão/retomada no navegador. Os artefatos da esteira ficam vinculados ao PR #6.
