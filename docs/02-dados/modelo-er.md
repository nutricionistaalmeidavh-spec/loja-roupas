# D2 — Modelo entidade-relacionamento lógico

Chaves técnicas UUID (exceto contadores/IDs de integração), timestamp com fuso no armazenamento UTC, preços monetários em centavos inteiros BRL, store_id quando pertinente. Modelos abaixo são lógicos; nomes físicos são proposta para revisão de D2.

~~~mermaid
erDiagram
 STORE ||--o{ USER_STORE_ROLE : autoriza
 USER ||--o{ USER_STORE_ROLE : possui
 STORE ||--o{ PRODUCT_VARIANT : disponibiliza
 PRODUCT ||--o{ PRODUCT_VARIANT : possui
 SIZE_CHART ||--o{ PRODUCT_VARIANT : orienta
 PRODUCT_VARIANT ||--o{ STOCK_MOVEMENT : movimenta
 PRODUCT_VARIANT ||--o{ STOCK_BALANCE : projeta
 STORE ||--o{ STOCK_BALANCE : mantem
 STOCK_COUNT ||--o{ STOCK_COUNT_LINE : inclui
 PRODUCT_VARIANT ||--o{ STOCK_COUNT_LINE : contado
 STORE ||--o{ CASH_SESSION : abre
 CASH_SESSION ||--o{ SALE : agrupa
 SALE ||--|{ SALE_LINE : contem
 PRODUCT_VARIANT ||--o{ SALE_LINE : vendido
 SALE ||--o{ PAYMENT : recebe
 SALE ||--o{ SALE_RETURN : origina
 CUSTOMER ||--o{ SALE : compra
 CUSTOMER ||--o{ CONSENT : registra
 CUSTOMER ||--o{ GIFT_CARD : recebe
 GIFT_CARD ||--o{ GIFT_CARD_MOVEMENT : registra
 SUPPLIER ||--o{ PURCHASE_ORDER : atende
 PURCHASE_ORDER ||--o{ PURCHASE_LINE : contem
 PURCHASE_ORDER ||--o{ RECEIPT : recebe
 RECEIPT ||--o{ STOCK_MOVEMENT : gera
 SALE ||--o{ LEDGER_ENTRY : referencia
 CUSTOMER_ORDER ||--o{ FULFILLMENT : entrega
 CUSTOMER ||--o{ CUSTOMER_ORDER : solicita
 PRICE_PUBLICATION ||--o{ PRICE_ENTRY : publica
 PRODUCT_VARIANT ||--o{ PRICE_ENTRY : precifica
~~~

## Donos e princípios
- Catálogo: PRODUCT, PRODUCT_VARIANT, SIZE_CHART, COLLECTION, KIT_COMPONENT.
- Estoque: STOCK_MOVEMENT, STOCK_BALANCE, STOCK_RESERVATION, STOCK_COUNT.
- PDV: SALE, SALE_LINE, SALE_RETURN; financeiro: CASH_SESSION, LEDGER_ENTRY; pagamentos: PAYMENT.
- Cliente e benefícios: CUSTOMER, CONSENT, GIFT_CARD, GIFT_CARD_MOVEMENT, LOYALTY_LEDGER.
- Compras: SUPPLIER, PURCHASE_ORDER, RECEIPT; pedidos: CUSTOMER_ORDER, FULFILLMENT.
- Regras de preço: PRICE_PUBLICATION, PRICE_ENTRY.
- Plataforma: AUDIT_LOG, OUTBOX_EVENT, IDEMPOTENCY_RECORD.

## Multiplicidade e integridade
- Produto tem 0..N variantes; variante tem SKU globalmente único por loja ou código de rede único conforme política definida e explicitada.
- Uma venda contém >=1 linhas, cada uma preserva descrição, SKU, preço, tributos apenas informativos se externos, descontos e custo no momento.
- Um pagamento pertence a venda ou documento de contas a receber; parcela e liquidação têm identidade próprias.
- Uma movimentação de estoque tem origem de negócio e chave natural de deduplicação; nenhuma edição retroativa, apenas contramovimento.
- Conteúdo pessoal removível não é copiado para logs/eventos além do mínimo.
- store_id será obrigatório em agregados transacionais mesmo com unidade única; não disponibilizar operações entre lojas ainda.

## Unidades e notação
Quantidade de peça em inteiro; produtos fracionáveis exigiriam ADR novo. Valores monetários em centavos, nunca float. Fuso do estabelecimento configurado, timestamps no banco UTC; ordem de eventos por stream com revision bigint.
