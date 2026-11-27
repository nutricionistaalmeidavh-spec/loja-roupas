/**
 * Cupom não fiscal em colunas para impressora térmica (32 colunas em 58 mm, 42 em 80 mm)
 * ou A4 meia folha (90 colunas). Valores sempre alinhados à direita.
 */
export type ReceiptRow =
  | { kind: 'center'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'pair'; label: string; value: string }
  | { kind: 'rule' };

export const RECEIPT_COLUMNS = [32, 42, 90] as const;

function wrap(text: string, cols: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (word.length > cols) {
      if (line) { out.push(line); line = ''; }
      for (let i = 0; i < word.length; i += cols) out.push(word.slice(i, i + cols));
      continue;
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= cols) line += ' ' + word;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

export function formatReceipt(rows: readonly ReceiptRow[], cols: number): string {
  const lines: string[] = [];
  for (const row of rows) {
    if (row.kind === 'rule') { lines.push('-'.repeat(cols)); continue; }
    if (row.kind === 'center') {
      for (const part of wrap(row.text, cols)) {
        const pad = Math.floor((cols - part.length) / 2);
        lines.push(' '.repeat(Math.max(0, pad)) + part);
      }
      continue;
    }
    if (row.kind === 'text') { lines.push(...wrap(row.text, cols)); continue; }
    const value = row.value.slice(0, cols);
    if (row.label.length + 1 + value.length <= cols) {
      lines.push(row.label + ' '.repeat(cols - row.label.length - value.length) + value);
    } else {
      const parts = wrap(row.label, cols);
      const last = parts.at(-1)!;
      if (last.length + 1 + value.length <= cols) {
        parts[parts.length - 1] = last + ' '.repeat(cols - last.length - value.length) + value;
        lines.push(...parts);
      } else lines.push(...parts, ' '.repeat(cols - value.length) + value);
    }
  }
  return lines.map(line => line.trimEnd()).join('\n') + '\n';
}
