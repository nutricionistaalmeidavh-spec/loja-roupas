-- Cupom não fiscal também em A4 meia folha (210 mm), além das bobinas de 58 e 80 mm.
ALTER TABLE receipt_print_requests DROP CONSTRAINT IF EXISTS receipt_print_requests_paper_mm_check;
ALTER TABLE receipt_print_requests ADD CONSTRAINT receipt_print_requests_paper_mm_check
  CHECK (paper_mm IN (58, 80, 210));
