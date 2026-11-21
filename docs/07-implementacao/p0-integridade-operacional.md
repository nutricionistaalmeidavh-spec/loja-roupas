# P0 — Integridade operacional de compras, estoque e devoluções

Implementação em branch de revisão. **Não homologada nem publicada.** Núcleo R$0, PostgreSQL self-hosted, sem PSP e sem mudanças em secrets.

## Recebimento conferido

Operador informa `received_quantity` (entregue), `accepted_quantity` (aprovada) e `reason` para divergências. Servidor impõe:

- `1 <= received_quantity <= quantidade_pedida`
- `0 <= accepted_quantity <= received_quantity`
- `rejected_quantity = received_quantity - accepted_quantity`
- `missing_quantity = quantidade_pedida - received_quantity`
- Divergência exige justificativa de pelo menos oito caracteres.
- Apenas **approved_quantity** entra no saldo vendável e na movimentação `purchase/receipt`, na mesma transação com auditoria.
- Quarentena (avaria) e falta de entrega ficam documentadas no pedido, não são disponibilizadas automaticamente.
- Mesmo identificador de operação devolve o mesmo resultado, sem duplicar entrada; concorrentes com chaves diferentes não recebem duas vezes.
- `PUT /purchases/{id}/quality` permanece como rota legada, mas responde 409: classificar após entrada sem movimentação compensatória não é seguro.

**Migração de compras anteriores:** `quality_finalized=false`. O estoque histórico não é reduzido automaticamente, pois já pode ter havido vendas, reservas ou correções; requer conciliação/inventário auditado na implantação.

## Devolução parcial, por linha e condição física

O endpoint de consulta por número de venda lista linhas com `available_to_return`. Na devolução:

- Apenas vendas originalmente pagas **inteiramente em dinheiro** entram no reembolso de caixa local; Pix/cartão exigem conciliação externa e continuam bloqueados.
- Cada item informa `sale_line_id`, `quantity` e condição `resellable` ou `quarantine`.
- Quantidades já devolvidas não podem ser recebidas novamente; a venda é bloqueada em `FOR UPDATE` antes de verificar saldo disponível.
- A devolução grava linha imutável de retorno, valor proporcional ao preço da venda, saída financeira, auditoria e eventual recomposição do saldo **na mesma transação**.
- `quarantine` registra a peça fisicamente recebida mas **não** incrementa `stock_balances.on_hand`.
- `partially_returned` mantém o saldo devolvível, enquanto `returned` marca a devolução integral.
- Repetir chave com mesmo payload não gera nova baixa; chave com conteúdo diferente é rejeitada.

**Compatibilidade:** `0018_p0_operational_integrity.sql` migra devoluções integrais antigas para `cash_return_lines` sem gerar nova entrada no estoque. A rota antiga agora requer os itens explicitamente; atualizar cliente e API juntos.

## Testes/gates

- `pnpm --filter @loja/api typecheck`, `pnpm --filter @loja/web typecheck`, build web.
- `pnpm --filter @loja/api migrate` sobre Postgres efêmero; `pnpm --filter @loja/api test`.
- Teste dedicado `p0-operational-integrity.integration.test.ts`: validações, conferência desigual, saldo aprovado, reentrada concorrente, devolução parcial, quarentena, replay da chave, devolução excedente e fechamento de caixa após reembolso.
- Suíte antiga de inventário deve preservar o tipo de evento `purchase.receive` e a rastreabilidade por operador.
- E2E Playwright, instalador e periféricos seguem gates separados; CI não equivale a homologação em hardware.

**Próximo passo antes de uma release:** rodar migração em cópia de dados reais, verificar inventário legado, fazer teste de devolução física em loja e confirmar política de destinação das peças em quarentena. Nenhum merge/release automático.
