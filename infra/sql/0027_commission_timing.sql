-- Quando a comissão do vendedor pode ser paga: na venda ('on_sale') ou só depois que a
-- cliente paga o crediário ('on_payment'). Vendas à vista não mudam nada.
ALTER TABLE stores ADD COLUMN commission_timing text NOT NULL DEFAULT 'on_payment'
  CHECK (commission_timing IN ('on_sale','on_payment'));
