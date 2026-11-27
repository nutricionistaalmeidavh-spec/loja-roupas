/*
 * Pix "copia e cola" estático (BR Code, padrão EMV do Banco Central) com a
 * chave da loja e o valor da venda. Não confirma o pagamento: a vendedora
 * continua conferindo no aplicativo do banco.
 */
export type PixPayloadInput = { key: string; name: string; city: string; amountCents?: number; txid?: string };

function field(id: string, value: string) {
  const size = new TextEncoder().encode(value).length;
  if (size > 99) throw new Error('Campo do Pix grande demais');
  return id + String(size).padStart(2, '0') + value;
}
/** Remove acentos e caracteres fora do conjunto aceito pelos bancos. */
export function pixText(value: string, max: number) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .,\-/@]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
export function crc16(payload: string) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(payload)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
/** Normaliza a chave: telefone ganha +55, CPF/CNPJ fica só com dígitos, e-mail em minúsculas. */
export function normalizePixKey(raw: string) {
  const key = raw.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return key.toLowerCase();
  if (key.includes('@')) return key.toLowerCase();
  if (key.startsWith('+')) return '+' + key.replace(/\D/g, '');
  const digits = key.replace(/\D/g, '');
  if (/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(key) || /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(key)) return digits;
  if (digits.length === 10 || digits.length === 11) return '+55' + digits;
  return key;
}
export function buildPixPayload({ key, name, city, amountCents, txid }: PixPayloadInput) {
  const cleanKey = normalizePixKey(key);
  if (!cleanKey) throw new Error('Cadastre a chave Pix da loja');
  const merchant = pixText(name, 25) || 'LOJA';
  const town = pixText(city, 15) || 'BRASIL';
  const reference = (txid ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  const account = field('00', 'br.gov.bcb.pix') + field('01', cleanKey);
  let payload = field('00', '01') + field('26', account) + field('52', '0000') + field('53', '986');
  if (amountCents && amountCents > 0) payload += field('54', (amountCents / 100).toFixed(2));
  payload += field('58', 'BR') + field('59', merchant) + field('60', town) + field('62', field('05', reference)) + '6304';
  return payload + crc16(payload);
}
