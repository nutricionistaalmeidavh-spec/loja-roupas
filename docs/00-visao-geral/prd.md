# D0 — Product Requirements Document (PRD)

## 1. Visão
Sistema de gestão e ponto de venda para boutique/loja de roupas, inicialmente uma unidade, com operação diária na rede local e interfaces desktop e PWA. Deve integrar produtos por variação, estoque confiável, caixa, vendas, pós-venda, compras, financeiro, CRM, marketing e inteligência comercial.

**Princípios contratuais:** R$ 0 / self-hosted / open source no núcleo; AGPLv3 prevista; qualquer serviço pago ou de terceiros somente por ativação deliberada; PostgreSQL é fonte única da verdade; sem merge/release automático.

## 2. Usuários e responsabilidades
| Persona | Tarefas | Restrições |
|---|---|---|
| Proprietário/gestor | definir preços, metas, fechamento, relatórios, permissões, backup | dupla confirmação para decisões irreversíveis |
| Caixa | abrir caixa, vender, receber, sangria, fechamento, reimprimir | desconto e estorno acima de limite exigem permissão |
| Vendedor | consultar produtos, reservar, provar, acompanhar comissão e clientes | não acessa dados financeiros globais |
| Estoquista | receber, contar, ajustar com aprovação, etiquetar, separar pedidos | não altera valores de venda sem permissão |
| Comprador | fornecedores, cotações, pedidos, reposição | sugestão não gera compra automaticamente |
| Administrador técnico | instalar, diagnosticar, restaurar e atualizar | acesso auditado, sem visão desnecessária de dados pessoais |
| Consumidor | catálogo público, pedido, acompanhamento, resgate de presente | acesso apenas a dados próprios |

## 3. Escopo funcional agrupado
1. **PDV e caixa:** código de barras, busca, carrinho, múltiplos meios de pagamento, suspensão, desconto autorizado, devolução, trocas, recibos não fiscais, sessões de caixa e auditoria. Venda confirmada somente em transação persistida.
2. **Catálogo e estoque:** produto-base e variante cor/tamanho, SKU/código único, fotos, medidas, coleções, tabela de preço, custo, controle de avaria, contagem, transferência interna e kits montáveis.
3. **Compras:** fornecedores, cotações, pedido, recebimento, divergência, consignação, devolução ao fornecedor, pontuação de desempenho e sugestão de reposição aprovada.
4. **Financeiro:** contas a pagar/receber, recebimentos, despesas, DRE operacional, fluxo de caixa, crediário, comissões e conciliação manual/importada. Estornos em lançamentos compensatórios.
5. **Clientes e benefícios:** cadastro mínimo, preferências, consentimentos, pontos, cashback, cupom, indicações, gift card, segmentação e comunicação apenas autorizada.
6. **Atendimento e pedidos:** provador, reservas, pré-vendas, catálogo digital, pedidos online para retirada/entrega, separação, comprovantes de entrega, ajustes de costura.
7. **Inteligência e planejamento:** dashboards, metas, previsões locais, análise por coleção, alertas com premissas explicadas; sempre recomendação, não ação financeira silenciosa.
8. **Plataforma:** importação com prévia e rollback lógico, segurança RBAC, logs e auditoria, busca contextual, instalação guiada, backups cifrados, atualizações supervisionadas e modo LAN.

## 4. Jornadas críticas e resultados
| Jornada | Entrada | Resultado comprovável |
|---|---|---|
| J01 Primeira instalação | instalador + credenciais iniciais | servidor LAN saudável, admin criado, backup testável |
| J02 Produto à venda | cadastrar variações + preço + recebimento | SKU encontrável, estoque disponível, etiqueta |
| J03 Venda ponta a ponta | caixa aberto + itens + pagamentos | venda confirmada, saldo reservado/baixado, financeiro e impressão consistentes |
| J04 Troca e devolução | venda original + item retornado | estoque e movimentação financeira compensados |
| J05 Compra | sugestão + aprovação + recebimento | custo documentado e estoque correto |
| J06 Fechamento | vendas/estornos e sangrias do turno | diferenças justificadas e sessão finalizada |
| J07 Pedido online | catálogo + compra/reserva + retirada/entrega | estados auditáveis e nenhum oversell |
| J08 Campanha de preços | simulação + aprovação + vigência | preço de checkout corresponde à versão publicada |
| J09 Recuperação | backup íntegro + administrador autorizado | restaurar em ambiente de teste, validar consistência |
| J10 Privacidade | pedido do titular | exportação/anonimização quando legalmente possível e registro |

## 5. Regras transversais
- Todo estoque é registrado por movimentação com origem, quantidade, unidade, variante, loja, operador, data e chave de idempotência; saldo é projeção atualizável dentro da mesma transação.
- Toda transação financeira rastreia origem, moeda BRL, valor inteiro em centavos, método, status e eventual compensação.
- Descontos, preços, comissões e benefícios são calculados no servidor e persistem a versão aplicada; cliente não define valor final.
- Gift card e créditos comerciais mantêm livro de movimentos; saldos negativos são proibidos.
- Históricos de preço e regras de vigência não se sobrepõem para mesmo escopo sem prioridade explicitada.
- Operações offline significam apenas ausência de internet pública, **não** indisponibilidade do servidor LAN.
- Canais externos são adaptadores opcionais; o produto funciona integralmente sem API paga.
- Documentos fiscais exigidos legalmente ficam fora deste MVP; incluir aviso operacional e exportação para solução fiscal adequada.

## 6. Fora do escopo do núcleo inicial
Emissão fiscal embarcada, gateway obrigatório, antifraude terceirizado, marketplace obrigatório, aplicativo nativo separado, roteirização avançada, banco de dados isolado com sincronização posterior entre caixas, inteligência artificial cloud como dependência.

## 7. Requisitos não funcionais
Consultar [RNFs](requisitos-nao-funcionais.md). Priorização por criticidade operacional, segurança, perda de dados, acessibilidade e disponibilidade LAN.

## 8. Definição de pronto do produto
- Todos os fluxos P0 com critérios de aceite e testes reproduzíveis.
- Documentação, contratos e migrações revisados antes da escrita de código.
- Sem bugs P0/P1 pendentes na candidata à homologação, backup e restore demonstrados.
- Instalador e operação LAN sem dependência de conta externa ou assinatura.
- Identificação expressa de recebimentos não fiscais e responsabilidades fiscais do comerciante.
- Release somente depois de autorização humana.

## 9. Métricas futuras (indicadores, sem prometer resultado)
Tempo de finalização de venda; taxa de divergência de estoque; falhas de impressão; taxa de pagamento duplicado (alvo zero); sucesso de backup/restore; uptime LAN; tempo para cadastro de variante; tempo para fechamento; margem real; performance de campanhas; consentimento válido de comunicações.

## 10. Questões configuráveis, não bloqueios ocultos
Legislação fiscal do estado e enquadramento da loja; política comercial de estorno e prazos; política de validade do gift card; meios de pagamento ativados; tipos de impressora; capacidade do servidor e metas de performance.
