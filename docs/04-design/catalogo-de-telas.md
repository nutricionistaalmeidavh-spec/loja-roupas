# D4 — Inventário de telas, campos e critérios UX

| ID | Tela | Papel | Elementos principais | Estado de erro crítico |
|---|---|---|---|---|
| UI-01 | Instalação | admin técnico | topologia, diagnóstico, segredo, backup | porta ocupada, falta de espaço |
| UI-02 | Login / PIN | todos | credenciais, operador, dispositivo | bloqueio por tentativas |
| UI-03 | Seleção de loja | todos | loja autorizada, contexto | usuário sem vínculo |
| UI-04 | Visão geral | gestor | widgets, metas e alertas | projeção indisponível |
| UI-05 | PDV catálogo visual | caixa/vendedor | rail compacto, busca/scan, filtros de categoria, grade fotográfica 3 colunas desktop, escolha cor/tamanho/variante exata | SKU inexistente, foto ausente, sem saldo, LAN caída |
| UI-06 | PDV carrinho persistente | caixa | sidebar desktop ou drawer mobile, miniatura, SKU, qty +/- , desconto, subtotal e total | estoque alterado, preço revisado, item removido |
| UI-07 | PDV etapa de pagamento | caixa | revisão separada, dinheiro/Pix manual/cartão/crediário, split, confirmação explícita | pagamento parcial, autorização negada, commit desconhecido |
| UI-08 | PDV comprovante | caixa | venda confirmada, identificação não fiscal, número, fila de impressão | impressão pendente, reimpressão auditada |
| UI-09 | Caixa abertura | caixa | troco, estação | caixa já aberto |
| UI-10 | Caixa fechamento | caixa | conferência, diferença | sem permissão |
| UI-11 | Cadastro produto | catálogo | wizard, mídia, categoria | duplicidade de SKU |
| UI-12 | Editor de grade | catálogo | matriz cor x tamanho | célula inválida |
| UI-13 | Estoque e disponibilidade | estoque | saldos, reservas, movimentos | revisão defasada |
| UI-14 | Contagem | estoque | escaneamento, tarefas | concorrência |
| UI-15 | Aprovação ajuste | gestor | divergências e justificativa | recontagem exigida |
| UI-16 | Etiquetas / impressão | estoque | templates, fila e status | dispositivo indisponível |
| UI-17 | Fornecedores | compras | histórico, scoring e evidência | amostra insuficiente |
| UI-18 | Pedido de compra | compras | linhas, custo, aprovação | quantidade inválida |
| UI-19 | Recebimento | estoque | entrega parcial e avaria | itens fora do pedido |
| UI-20 | Clientes | vendedor/gestor | dados mínimos, consentimento | falta de permissão |
| UI-21 | Fidelidade | CRM | pontos, crédito e validade | resgate conflitante |
| UI-22 | Cartões-presente | gestor/caixa | emissão, saldo, histórico | saldo insuficiente |
| UI-23 | Provadores | vendedor | peças, tamanhos, status | item indisponível |
| UI-24 | Reservas | vendedor | prazo, sinal, status | reserva expirada |
| UI-25 | Pedidos online | equipe | pedido, separação, canal | estado incompatível |
| UI-26 | Entregas | logística | motorista, tentativa, prova | entrega sem autorização |
| UI-27 | Devoluções/trocas | caixa/gestor | venda origem, itens, saldo | excede vendida |
| UI-28 | Costura/ajustes | atendimento | serviço, prazo e cobrança | medida ausente |
| UI-29 | Consignação | compras | proprietário, saldos | propriedade inconsistente |
| UI-30 | Preços | gestor | preços, regras, custos | regra sobreposta |
| UI-31 | Publicação de preços | gestor | versões, aprovação, etiquetas | conflito de vigência |
| UI-32 | Promoções e campanhas | gestor | público, consentimento, ROI | opt-out |
| UI-33 | Coleções e sazonalidade | gestor | calendário, giro, curva | amostra insuficiente |
| UI-34 | Metas comerciais | gestor | meta e forecast | cenário sem evidência |
| UI-35 | Contas a pagar | financeiro | fornecedor, vencimentos | duplicidade origem |
| UI-36 | Contas a receber | financeiro | crediário, parcela, baixa | conciliação divergente |
| UI-37 | DRE e relatórios | gestor | competência/caixa, filtros | dados parciais |
| UI-38 | Importador | gestor | mapeamento, prévia, erros | linhas rejeitadas |
| UI-39 | Usuários e permissões | gestor | RBAC, dispositivo, PIN | ação segregada |
| UI-40 | Central de auditoria | gestor | eventos, ator, filtro | acesso restrito |
| UI-41 | Backup/restore | admin | hash, destino, prova | backup corrompido |
| UI-42 | Atualizações | admin | versão, changelog, gate | migração incompatível |
| UI-43 | Catálogo público | cliente | produto, variantes, disponibilidade | produto retirado |
| UI-44 | Checkout de pedido | cliente | reserva, entrega/retirada | estoque indisponível |
| UI-45 | Acompanhamento | cliente | status e instruções | token inválido |
| UI-46 | Kits e presentes | vendedor | itens, embalagem, mensagem | composição inválida |
| UI-47 | Indicações | CRM | origem, regra, antifraude | atribuição duplicada |
| UI-48 | Busca global | autorizado | filtros e resultados por área | dado sem permissão |

## Matriz de dispositivos
- Desktop: todas as telas administrativas e operacionais pertinentes.
- PWA: telas operacionais por papel, particularmente produtos, inventário, atendimento, pedidos e relatórios resumidos.
- Público responsivo: apenas UI-43 a UI-45, com autenticação própria quando for necessário consultar pedido individual.
- Caixa no celular: fluxo orientado e restrito aos periféricos disponíveis; não prometer leitura de balança/USB sem agente compatível.

## Fluxo de homologação UX
Revisar estrutura por papel → desenhar protótipo visual → simular erros/estados vazios → validar teclado/leitor de tela/contraste → testar tarefas com operadores reais → aprovar antes do código. Este arquivo entrega inventário e comportamento, não artefato navegável.

## Critério transversal do PDV
O layout aprovado pelas preferências do gestor está em [UX-RPOS-01](direcao-visual-retail-pos.md). As telas UI-05 a UI-08 devem compartilhar o mesmo carrinho, independentemente do modo de seleção por scanner ou catálogo; não criar dois estados de venda. O mockup antigo marrom com lista está obsoleto para UI-05.
