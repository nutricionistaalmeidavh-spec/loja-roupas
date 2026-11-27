-- Chave Pix da loja para gerar o QR Code (Pix estático) do valor da venda.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS pix_key text CHECK (pix_key IS NULL OR length(pix_key) BETWEEN 3 AND 77);
ALTER TABLE stores ADD COLUMN IF NOT EXISTS pix_city text CHECK (pix_city IS NULL OR length(pix_city) BETWEEN 2 AND 60);
