# D5 — Matriz QA por decisão e cenários canônicos

Nenhum caso está executado. QA-Dnn é obrigatório para cada Dnn; a coluna "Verificação de aceite" em [decisões](../00-visao-geral/decisoes-001-065.md) define o resultado esperado, e esta matriz orienta a execução.

| Faixa | Cenário transversal |
|---|---|
| D01–D04 | Criar loja, acessar desktop/PWA, vender por código e gerir grade; validar SKU/estoque únicos. |
| D05–D08 | Trocar item e conceder crédito; conciliar contas, fidelidade e comissão por venda dividida. |
| D09–D12 | Sugerir compra sem autorizar, imprimir com fila, perder WAN e restaurar backup cifrado. |
| D13–D16 | Gerar recibo rotulado não fiscal, instalar via wizard, verificar painéis e cores/contraste. |
| D17–D20 | Configurar widgets, operar PDV em etapas, cadastrar grade e inventariar com aprovação. |
| D21–D24 | Validar estimativas com premissas, atualização autorizada, importação preview, regras personalizadas. |
| D25–D28 | Provar limites paralelos do monólito, PostgreSQL canônico e desktop React/Electron sem DB no cliente. |
| D29–D32 | Simular falha de impressora, negar permissão no backend, instalar sem .env e executar sem SaaS pago. |
| D33–D36 | Verificar gates, monorepo, outbox idempotente e acesso remoto opt-in sem afetar LAN. |
| D37–D40 | Retomar timeout sem venda dupla, pagar em múltiplos meios, simular promoção e reservar com depósito. |
| D41–D44 | Gerir provador, store_id, tabela de medidas, contratos REST e eventos com cursor. |
| D45–D48 | Revogar marketing, verificar licença AGPL proposta, buscar sob autorização e registrar avaria. |
| D49–D52 | Distinguir consignação, costura, catálogo público e pedidos por retirada/entrega. |
| D53–D56 | Conferir prova de entrega, jornada de relacionamento autorizada, indicação e coleção. |
| D57–D61 | Validar score de fornecedor, ledger gift card, kit sem dupla baixa, versão de preços e meta com devoluções. |
| D62–D65 | Verificar execução paralela, consumer contracts, gates e inexistência de código antes de homologação. |

## Testes rastreáveis P0 (exemplo de especificação formal)
| Caso | Decisões | Preparação | Ação | Resultado esperado |
|---|---|---|---|---|
| QA-PDV-001 | D03,D27,D35,D37 | estoque=1, dois caixas | confirmar 2 vendas simultâneas | exatamente 1 sucesso e 1 conflito |
| QA-PDV-002 | D03,D35,D37 | venda e chave K | perder resposta e repetir K | 1 venda, 1 movimento e mesma resposta |
| QA-PDV-003 | D38,D05 | pagamentos mistos | confirmar e estornar parcialmente | compensação e saldo correto |
| QA-INV-001 | D04,D20,D48 | contagem em 2 dispositivos | aprovar uma divergência | 1 movimento, revisão única |
| QA-INV-002 | D09,D57 | compra recebida parcialmente | repetir requisição idempotente | 1 recebimento efetivo |
| QA-FIN-001 | D06,D30 | caixa aberto | fechar com diferença e exigir papel | bloqueio ou justificativa auditada |
| QA-BEN-001 | D58 | gift card com saldo 100 | duas requisições de 80 simultâneas | não permitir saldo negativo |
| QA-KIT-001 | D59 | kit 2 itens | vender kit e repetir timeout | componentes baixados uma vez |
| QA-PRE-001 | D39,D60 | campanha aprovada | ativar e reimprimir etiquetas | preço PDV e versão consistentes |
| QA-NET-001 | D11,D36 | servidor local operacional | desconectar WAN | fluxo LAN continua |
| QA-NET-002 | D11,D37 | carrinho em rascunho | desligar servidor | nenhuma venda falsa confirmada |
| QA-SEC-001 | D30,D45 | usuário sem permissão | chamar endpoint admin direto | 403 sem revelar dados |
| QA-SEC-002 | D42 | usuário loja A | requisitar dados loja B | 403/404 escopado |
| QA-DAT-001 | D12,D22 | backup recente | corromper arquivo | integridade falha sem restaurar |
| QA-API-001 | D44,D63 | consumidor com schema v1 | mudança aditiva | contrato compatível |
| QA-OPS-001 | D14,D31 | host novo | instalar via wizard | inicia sem conta SaaS ou .env manual |

## Cenários detalhados complementares
- Todos os 65 IDs possuem um QA-Dnn no registro decisório; ao criar a suíte, um caso executável por ID, no mínimo, deverá referenciar explicitamente seu requisito.
- Teste de recibo não fiscal e aviso operacional, inclusive quando houver requisito estadual de documento fiscal.
- Teste de acessibilidade para contraste, teclado, foco de modal, erro de campo e 320 px.
- Teste de logs: não vazar senha, token de sessão, CPF completo nem conteúdo privado em payload de evento.
- Testes de carga: estoque sob concorrência, importação grande, busca e fechamento.
- Teste de perda de impressão após venda: fila retoma sem reexecutar venda.

## QA-UX-01 a QA-UX-12 — rastreio adicional Retail Fashion POS
| Caso | Verificação |
|---|---|
| QA-UX-01 | 1440x900 e 1366x768: rail compacto, grade 3 colunas, carrinho sticky e total visível, sem overflow horizontal |
| QA-UX-02 | 1280x800: nomes longos, preços e variantes não ficam truncados |
| QA-UX-03 | 1024/768/390/320px: responsividade e drawer de carrinho alcançável |
| QA-UX-04 | Tamanho+cor mapeiam exatamente a um SKU/variant_id, sem combinações inexistentes |
| QA-UX-05 | Scanner, pesquisa e card colocam a mesma variante no carrinho único |
| QA-UX-06 | Preço/estoque alterados no servidor obrigam cotação/revisão, sem confirmação silenciosa |
| QA-UX-07 | Navegação por teclado, labels, foco, leitor de tela, zoom 200% e contraste AA |
| QA-UX-08 | Falha da foto/thumbnail não impede busca, scan e venda |
| QA-UX-09 | Carrinho com mais de 10 linhas mantém subtotal e CTA acessíveis |
| QA-UX-10 | WAN fora não bloqueia venda LAN; servidor LAN fora impede commit |
| QA-UX-11 | Timeout pós-commit com mesma chave não duplica venda, baixa ou pagamento |
| QA-UX-12 | Screenshot de regressão em sete viewports comparado ao mockup aprovado e revisão humana |
