import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCurrency,
  getPaidSummaryDisplay,
  formatTime,
  formatReceiptDateTime,
  formatExpenseDateGroup,
  getDateKey,
  groupExpensesByDate,
} from '../src/client/lib/format.js';

test('formatTime extracts 2-digit hour and minute', () => {
  assert.equal(formatTime(''), '');
  assert.equal(formatTime(null), '');
  assert.equal(formatTime('invalid'), '');
  const time = formatTime('2026-11-12T12:07:00');
  assert.match(time, /^\d{2}:\d{2}$/);
});

test('formatReceiptDateTime formats compact receipt header timestamp', () => {
  assert.equal(formatReceiptDateTime(''), '');
  assert.equal(formatReceiptDateTime(null), '');
  assert.equal(formatReceiptDateTime('invalid'), '');
  const formatted = formatReceiptDateTime('2026-11-12T12:07:00');
  assert.match(formatted, /^12 [a-zç]+ 2026 · \d{2}:\d{2}$/i);
});

test('formatExpenseDateGroup handles hoje, ontem, and formatted dates', () => {
  const now = new Date();
  assert.equal(formatExpenseDateGroup(now.toISOString()), 'hoje');

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  assert.equal(formatExpenseDateGroup(yesterday.toISOString()), 'ontem');

  const specificDate = new Date(2026, 10, 11, 14, 0, 0); // Nov 11, 2026
  const formatted = formatExpenseDateGroup(specificDate.toISOString());
  assert.ok(formatted.includes('11 de nov. 2026') || formatted.includes('hoje') || formatted.includes('ontem'));
});

test('groupExpensesByDate groups by calendar date and identifies payer sequences', () => {
  const expenses = [
    { id: '1', payer_id: 'user_1', description: 'Gasolina', created_at: '2026-11-12T12:07:00' },
    { id: '2', payer_id: 'user_2', description: 'Almoço', created_at: '2026-11-12T04:43:00' },
    { id: '3', payer_id: 'user_2', description: 'Mercado', created_at: '2026-11-12T04:41:00' },
    { id: '4', payer_id: 'user_1', description: 'Estacionamento', created_at: '2026-11-11T14:00:00' },
    { id: '5', payer_id: 'user_1', description: 'Pedágio', created_at: '2026-11-11T13:30:00' },
  ];

  const groups = groupExpensesByDate(expenses);
  assert.equal(groups.length, 2);

  // Group 1 (2026-11-12)
  const g1 = groups[0];
  assert.equal(g1.items.length, 3);
  assert.equal(g1.items[0].isFirstInSequence, true);
  assert.equal(g1.items[1].isFirstInSequence, true);
  assert.equal(g1.items[2].isFirstInSequence, false); // user_2 chained from items[1]

  // Group 2 (2026-11-11)
  const g2 = groups[1];
  assert.equal(g2.items.length, 2);
  assert.equal(g2.items[0].isFirstInSequence, true); // new group resets sequence
  assert.equal(g2.items[1].isFirstInSequence, false); // user_1 chained
});

test('getPaidSummaryDisplay switches label and magnitude when netPaid is negative', () => {
  assert.equal(getPaidSummaryDisplay(null), null);
  assert.deepEqual(
    getPaidSummaryDisplay({ netPaid: 5000 }, { own: true }),
    { label: 'você pagou', amountCents: 5000, isNegativeNetPaid: false },
  );
  assert.deepEqual(
    getPaidSummaryDisplay({ netPaid: -5000 }, { own: true }),
    { label: 'você recebeu', amountCents: 5000, isNegativeNetPaid: true },
  );
  assert.deepEqual(
    getPaidSummaryDisplay({ totalPaid: 0, paymentsSent: 0, paymentsReceived: 3500 }),
    { label: 'recebeu', amountCents: 3500, isNegativeNetPaid: true },
  );
  assert.deepEqual(
    getPaidSummaryDisplay({ netPaid: 0 }),
    { label: 'pagou', amountCents: 0, isNegativeNetPaid: false },
  );
});
