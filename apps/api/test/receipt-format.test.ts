import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReceipt } from '../src/receipt-format.ts';

test('cupom em 32 colunas alinha valores à direita e não passa da largura', () => {
  const text = formatReceipt([
    { kind: 'center', text: 'BOUTIQUE AURORA' },
    { kind: 'rule' },
    { kind: 'text', text: '1 × Vestido Midi Linho com nome bem comprido (Areia/M)' },
    { kind: 'pair', label: '  1 × R$ 189,90', value: 'R$ 189,90' },
    { kind: 'pair', label: 'TOTAL', value: 'R$ 189,90' },
    { kind: 'pair', label: 'DESCONTO (cliente fiel de muitos anos da loja)', value: '-R$ 10,00' },
  ], 32);
  const lines = text.trimEnd().split('\n');
  for (const line of lines) assert.ok(line.length <= 32, line);
  assert.equal(lines[1], '-'.repeat(32));
  assert.match(text, /^TOTAL {18}R\$ 189,90$/m);
  assert.ok(lines.some(l => l.endsWith('-R$ 10,00')));
  assert.match(lines[0], /^ {8}BOUTIQUE AURORA$/);
});

test('cupom em 42 colunas mantém o rótulo e o valor na mesma linha', () => {
  const text = formatReceipt([{ kind: 'pair', label: 'DINHEIRO', value: 'R$ 200,00' }], 42);
  assert.equal(text, 'DINHEIRO' + ' '.repeat(42 - 8 - 9) + 'R$ 200,00\n');
});
