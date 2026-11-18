# D2 — Transações, concorrência, custo e migrações

## T1 Checkout canônico
1. Validar autenticação, role, caixa aberto e idempotency-key.
2. Ler preço publicado vigente e descontos autorizados; congelar snapshots na venda.
3. Abrir transação; bloquear saldos das variantes em ordem estável; verificar disponibilidade.
4. Criar venda e linhas; baixar ou consumir reservas; inserir movimentos de estoque, pagamentos confirmados locais e lançamentos do caixa.
5. Persistir auditoria e eventos outbox na mesma transação; commit.
6. Retornar venda com estado e identificador estável; impressão fica em fila pós-commit.
7. Retry da mesma chave retorna resposta original; payload divergente retorna conflito. Não duplicar estoque.

## T2 Pedido/reserva
Estado: draft → awaiting_payment (se necessário) → reserved → picking → ready_for_pickup/out_for_delivery → fulfilled; cancel/expired permite liberar reserva sem inventar venda. TTL, quantidades e pagamento são parametrizáveis. Reservas usam bloqueio transacional; UI pública exibe disponibilidade aproximada com aviso de confirmação no checkout.

## T3 Devolução/troca
Identificar linha vendida; verificar saldo retornável acumulado; exigir autorização conforme perfil; movimento positivo de estoque somente após conferência do estado físico; emitir compensação financeira ou crédito, nunca deletar venda original.

## T4 Recebimento de compra
Pedido aprovado → recebimento parcial com divergências → custo observado → movimentação de estoque e lançamento de contas a pagar associado. Produto rejeitado não vira estoque vendável.

## T5 Gift card, fidelidade e crédito
Ledger append-only, saldo = soma de movimentos elegíveis. Emissão gera obrigação registrada; resgate verifica saldo disponível com lock e operação única; estorno registra movimento inverso. Expiração e tratamento contábil dependem de regra legal configurada, sem confundir receita de venda com recebimento antecipado.

## T6 Publicação de preço
Rascunho → simulação → aprovação → agendamento → ativação. Versão ativa única por escopo/regra e vigência. A impressão recebe snapshot da publicação; divergência física fica pendente; nenhuma etiqueta modifica preço ativo por si só.

## T7 Inventário e perdas
Contagem registra observado e esperado no momento do fechamento; aprovação gera ajuste delta único. Recontagem exige nova revisão e movimento de compensação, não edição do ajuste passado.

## Estratégia de migração
- Migrações numeradas imutáveis com checksum.
- Expand → migrate data → contract; não remover coluna utilizada por versão anterior durante atualização assistida.
- Teste de upgrade com cópia anonimizada e teste de restore; avaliar lock longo, espaço livre e janela de indisponibilidade.
- Rollback é **plano**, não promessa: DDL irreversível demanda restore e plano de continuidade.
- Índices grandes criados de maneira compatível com a estratégia de deploy.
- Separar cálculo de saldo de reconstrução: conciliações periódicas com movimentos e alertas de divergência.

## Política de dados financeiros
Inteiros em centavos BRL; nenhuma aritmética de dinheiro em ponto flutuante. DRE operacional distingue competência/caixa e não pretende substituir contabilidade profissional ou escrituração fiscal obrigatória.
