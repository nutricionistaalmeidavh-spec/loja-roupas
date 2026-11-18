# D4 — Jornadas, fluxos de tela e wireframes textuais

Wireframes para aprovação de conteúdo e comportamento; não representam um protótipo visual navegável implementado.

## J01 Onboarding / instalação
~~~text
[Assistente Loja de Roupas]  Etapa 2/7
Servidor: [Este computador / Servidor existente]
Endereço LAN detectado: [________________] [Testar]
Loja: [________________]  Fuso: [America/Sao_Paulo]
[Voltar]                           [Continuar]
Aviso: nenhuma conta externa é necessária.
~~~
Fluxo: checagem → topologia → parâmetros → admin → conexões/periféricos → backup inicial → status. Falha de disco/porta impede conclusão e mostra orientação; segredos criados internamente, nunca formulário que peça arquivo .env.

## J02 Cadastro de produto e variações
~~~text
Produtos / Novo produto                  [Salvar rascunho]
Nome [________________]  Marca [_____________]
Coleção [__________]   Categoria [__________]
GRADE             P        M        G       GG
Preto           [SKU]    [SKU]    [SKU]   [SKU]
Bege            [SKU]    [SKU]    [SKU]   [SKU]
[Gerar SKUs] [Validar códigos] [Adicionar imagens]
[Voltar] [Revisar estoque/preço] [Publicar cadastro]
~~~
Fluxo: dados-base → grade → códigos → preço e custo → imagens/etiquetas → revisão. Conflitos de SKU na mesma loja devem destacar a célula e impedir salvar como publicado.

## J03 PDV guiado
~~~text
[Loja] [Caixa #01 ABERTO] [Operador] [LAN OK]
Buscar produto / código de barras [____________]
Itens do carrinho                  Resumo
Blusa M x1      R$ 129,90          Subtotal R$...
Calça 40 x1     R$ 159,90          Desconto R$...
[-] [+] [Suspender]                Total R$...
[Aplicar cupom/benefício] [Pagamento →]
[Dinheiro] [Pix manual] [Cartão externo] [Crédito]
Pagamento misto:  restante R$...
[Confirmar venda] [Solicitar autorização]
~~~
Fluxo: leitura → consulta de preço e estoque → carrinho → benefício → meios → revisão → commit → número/recibo. Se LAN cair após clique, UI deve consultar a idempotency-key; jamais presumir falha e reenviar como venda nova. Periférico offline = recibo pendente, venda permanece confirmada.

## J04 Devolução/troca
Buscar venda → selecionar itens e quantidade → conferir estado físico → escolher devolução, troca ou crédito → revisão de valores → autorização quando aplicável → confirmação → comprovante. Mostrar "já devolvido" e saldo restante.

## J05 Compras e recebimento
Sugestões → comparar fornecedores e evidências → editar pedido → aprovação humana → recebimento parcial com divergências → conferir avarias e custo → lançar movimentos. Nunca ativar compra automática.

## J06 Inventário colaborativo
Abrir contagem por local → distribuir lista aos colaboradores → ler códigos → registrar contado → comparar divergência → recontar onde exigido → aprovação segregada → aplicar movimentos únicos. A lista nunca ajusta saldo sem aprovação.

## J07 Reserva e pedido online
Catálogo → variante → disponibilidade informativa → reserva com prazo → pedido e modalidade → separação → retirada ou entrega com confirmação → concluído. Cancelar ou expirar libera reserva de forma idempotente. A URL do catálogo não expõe cadastro interno.

## J08 Gestão de preço
Selecionar produtos → regras → simular margem e conflito → aprovar → programar vigência → publicar preço canônico → listar etiquetas físicas pendentes → confirmar troca por lote. Se etiqueta estiver pendente, mostrar alerta antes de vender item afetado; observar a regra aplicável ao consumidor.

## J09 Gift cards e kits
Montar kit → escolher itens e embalagem → mostrar preço/custo → confirmar e baixar componentes uma vez. Gift card: emitir código → entregar → consultar saldo autorizado → resgate parcial → ledger + financeiro; bloquear sem apagar histórico.

## J10 Cliente, privacidade e campanhas
Cadastrar mínimo → preferência e consentimento específico → histórico → segmentar autorizado → simular campanha → aprovar e disparar pelo canal local/opt-in. Revogação interrompe novos envios. Não bloquear venda se cliente não consentir marketing.

## J11 Caixa e financeiro
Abrir caixa → registrar suprimento/sangria → vendas → verificar meios e crediário → contagem física → diferença/justificativa → fechar e exportar relatório. Não alterar fechamento anterior sem novo ajuste auditado.

## J12 Backup/restauração e atualização
Configurações → proteção de dados → backup → validar hash → executar teste de restore em destino separado → visualizar relatório → aprovar atualização → verificar health e cenário de rollback. Ação destrutiva exige segunda confirmação.

## Regras de navegação
- Em desktop: fluxo PDV com atalhos opcionais documentados, foco em leitura de código e operações rápidas.
- Em mobile: acessos mínimos por papel, barra inferior, uma ação principal por tela; evitar tabela horizontal crítica.
- Em todo fluxo: mostra contexto da loja, operador, estado LAN, revision do recurso quando relevante e retorno de sucesso idempotente.
- Permissões: ocultar recurso é conveniência de UX; backend é a barreira de segurança.
- Testes com operadores reais antes de homologar: 1 caixa, 1 vendedor, 1 gestor, 1 estoquista, em desktop e PWA.
