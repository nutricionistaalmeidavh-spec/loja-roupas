import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceiptSettings, receiptColumns, DEFAULT_RECEIPT_SETTINGS } from './receipt-settings.ts';

test('preferências da notinha aceitam só papéis conhecidos e voltam ao padrão se corrompidas', () => {
  assert.deepEqual(parseReceiptSettings(null), DEFAULT_RECEIPT_SETTINGS);
  assert.deepEqual(parseReceiptSettings('{quebrado'), DEFAULT_RECEIPT_SETTINGS);
  assert.deepEqual(parseReceiptSettings(JSON.stringify({ paper: 58, printer: 'Epson TM-T20', autoPrint: true })),
    { paper: 58, printer: 'Epson TM-T20', autoPrint: true });
  assert.equal(parseReceiptSettings(JSON.stringify({ paper: 100 })).paper, 80);
  assert.equal(parseReceiptSettings(JSON.stringify({ autoPrint: 'sim' })).autoPrint, false);
});

test('colunas do cupom por papel', () => {
  assert.equal(receiptColumns(58), 32);
  assert.equal(receiptColumns(80), 42);
  assert.equal(receiptColumns(210), 90);
});
