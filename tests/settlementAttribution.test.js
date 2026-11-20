import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSettlementAttribution } from '../src/domain/settlementAttribution.js';

const participants = [
  { id: 'alice', name: 'Alice' },
  { id: 'bob', name: 'Bob' },
  { id: 'carol', name: 'Carol' },
];

test('computeSettlementAttribution settles oldest-to-newest FIFO and marks partial on oldest open item', () => {
  const expenses = [
    {
      id: 'exp-1',
      description: 'Churrasco',
      amount: 12000,
      payer_id: 'bob',
      split_mode: 'EQUAL_ALL', // 4000 each
      splits: [],
      created_at: '2026-11-10T12:00:00.000Z',
    },
    {
      id: 'exp-2',
      description: 'Bebidas',
      amount: 9000,
      payer_id: 'bob',
      split_mode: 'EQUAL_ALL', // 3000 each
      splits: [],
      created_at: '2026-11-10T14:00:00.000Z',
    },
    {
      id: 'exp-3',
      description: 'Sobremesa',
      amount: 6000,
      payer_id: 'bob',
      split_mode: 'EQUAL_ALL', // 2000 each
      splits: [],
      created_at: '2026-11-10T16:00:00.000Z',
    },
  ];
  const settlements = [
    {
      id: 'stl-1',
      from_participant_id: 'alice',
      to_participant_id: 'bob',
      amount: 5500, // 4000 clears exp-1 + 1500 partial on exp-2
      created_at: '2026-11-10T18:00:00.000Z',
    },
  ];

  const receipt = computeSettlementAttribution({
    settlementId: 'stl-1',
    participants,
    expenses,
    settlements,
  });

  assert.equal(receipt.breakdown.debtBeforeCents, 9000);
  assert.equal(receipt.breakdown.settledCents, 5500);
  assert.equal(receipt.breakdown.remainingCents, 3500);
  assert.equal(receipt.mutualOffsetCents, 0);
  assert.equal(receipt.groupDebtBeforeCents, 0);

  assert.deepEqual(
    receipt.items.map(item => ({
      id: item.expenseId,
      status: item.status,
      settledNow: item.settledNowCents,
      remaining: item.remainingAfterCents,
    })),
    [
      { id: 'exp-1', status: 'settled_now', settledNow: 4000, remaining: 0 },
      { id: 'exp-2', status: 'partial_now', settledNow: 1500, remaining: 1500 },
      { id: 'exp-3', status: 'open', settledNow: 0, remaining: 2000 },
    ],
  );
});

test('computeSettlementAttribution strictly ignores expenses and settlements created after target settlement', () => {
  const expenses = [
    {
      id: 'exp-1',
      description: 'Almoço',
      amount: 10000,
      payer_id: 'bob',
      split_mode: 'SUBSET_EQUAL',
      splits: [{ participant_id: 'alice' }, { participant_id: 'bob' }], // 5000 Alice
      created_at: '2026-11-10T12:00:00.000Z',
    },
    {
      id: 'exp-future',
      description: 'Jantar futuro',
      amount: 8000,
      payer_id: 'bob',
      split_mode: 'SUBSET_EQUAL',
      splits: [{ participant_id: 'alice' }, { participant_id: 'bob' }], // 4000 Alice
      created_at: '2026-11-12T12:00:00.000Z',
    },
  ];
  const settlements = [
    {
      id: 'stl-1',
      from_participant_id: 'alice',
      to_participant_id: 'bob',
      amount: 5000,
      created_at: '2026-11-11T10:00:00.000Z',
    },
  ];

  const receipt = computeSettlementAttribution({
    settlementId: 'stl-1',
    participants,
    expenses,
    settlements,
  });

  assert.equal(receipt.items.length, 1);
  assert.equal(receipt.items[0].expenseId, 'exp-1');
  assert.equal(receipt.items[0].status, 'settled_now');
  assert.equal(receipt.breakdown.remainingCents, 0);
});

test('computeSettlementAttribution tracks sequential payments and recalculates when prior items are edited', () => {
  const baseExpenses = [
    {
      id: 'exp-1',
      description: 'Mercado',
      amount: 10000,
      payer_id: 'bob',
      split_mode: 'SUBSET_EQUAL',
      splits: [{ participant_id: 'alice' }, { participant_id: 'bob' }], // 5000 Alice
      created_at: '2026-11-10T10:00:00.000Z',
    },
    {
      id: 'exp-2',
      description: 'Farmácia',
      amount: 6000,
      payer_id: 'bob',
      split_mode: 'SUBSET_EQUAL',
      splits: [{ participant_id: 'alice' }, { participant_id: 'bob' }], // 3000 Alice
      created_at: '2026-11-10T12:00:00.000Z',
    },
  ];
  const settlements = [
    {
      id: 'stl-1',
      from_participant_id: 'alice',
      to_participant_id: 'bob',
      amount: 3000,
      created_at: '2026-11-10T14:00:00.000Z',
    },
    {
      id: 'stl-2',
      from_participant_id: 'alice',
      to_participant_id: 'bob',
      amount: 4000,
      created_at: '2026-11-10T16:00:00.000Z',
    },
  ];

  const secondReceipt = computeSettlementAttribution({
    settlementId: 'stl-2',
    participants,
    expenses: baseExpenses,
    settlements,
  });

  assert.equal(secondReceipt.breakdown.debtBeforeCents, 5000);
  assert.equal(secondReceipt.breakdown.settledCents, 4000);
  assert.equal(secondReceipt.breakdown.remainingCents, 1000);
  assert.deepEqual(
    secondReceipt.items.map(i => ({
      id: i.expenseId,
      prior: i.settledPriorCents,
      now: i.settledNowCents,
      rem: i.remainingAfterCents,
      status: i.status,
    })),
    [
      { id: 'exp-1', prior: 3000, now: 2000, rem: 0, status: 'settled_now' },
      { id: 'exp-2', prior: 0, now: 2000, rem: 1000, status: 'partial_now' },
    ],
  );

  // Retroactively editing exp-1 down to 4000 (2000 Alice) recalculates stl-2 automatically
  const editedExpenses = [
    { ...baseExpenses[0], amount: 4000 },
    baseExpenses[1],
  ];
  const recalculatedSecond = computeSettlementAttribution({
    settlementId: 'stl-2',
    participants,
    expenses: editedExpenses,
    settlements,
  });

  assert.equal(recalculatedSecond.breakdown.debtBeforeCents, 2000);
  assert.equal(recalculatedSecond.breakdown.settledCents, 2000);
  assert.equal(recalculatedSecond.breakdown.creditedCents, 2000);
  assert.deepEqual(
    recalculatedSecond.items.map(i => ({
      id: i.expenseId,
      prior: i.settledPriorCents,
      now: i.settledNowCents,
      rem: i.remainingAfterCents,
      status: i.status,
    })),
    [
      { id: 'exp-1', prior: 2000, now: 0, rem: 0, status: 'settled_prior' },
      { id: 'exp-2', prior: 1000, now: 2000, rem: 0, status: 'settled_now' },
    ],
  );
});

test('computeSettlementAttribution reconciles cross-expenses (bilateral mutual offset)', () => {
  const expenses = [
    {
      id: 'exp-1',
      description: 'Jantar',
      amount: 12000,
      payer_id: 'bob',
      split_mode: 'SUBSET_EQUAL',
      splits: [{ participant_id: 'alice' }, { participant_id: 'bob' }], // 6000 Alice
      created_at: '2026-11-10T10:00:00.000Z',
    },
    {
      id: 'exp-2',
      description: 'Café',
      amount: 8000,
      payer_id: 'bob',
      split_mode: 'SUBSET_EQUAL',
      splits: [{ participant_id: 'alice' }, { participant_id: 'bob' }], // 4000 Alice
      created_at: '2026-11-10T11:00:00.000Z',
    },
    {
      id: 'exp-cross',
      description: 'Uber',
      amount: 6000,
      payer_id: 'alice',
      split_mode: 'SUBSET_EQUAL',
      splits: [{ participant_id: 'alice' }, { participant_id: 'bob' }], // 3000 Bob
      created_at: '2026-11-10T12:00:00.000Z',
    },
  ];
  const settlements = [
    {
      id: 'stl-1',
      from_participant_id: 'alice',
      to_participant_id: 'bob',
      amount: 4500, // debtBefore is 7000 (10000 - 3000), remaining is 2500
      created_at: '2026-11-10T14:00:00.000Z',
    },
  ];

  const receipt = computeSettlementAttribution({
    settlementId: 'stl-1',
    participants,
    expenses,
    settlements,
  });

  assert.equal(receipt.breakdown.debtBeforeCents, 7000);
  assert.equal(receipt.mutualOffsetCents, 3000);
  assert.equal(receipt.groupDebtBeforeCents, 0);
  assert.equal(receipt.compensationDetails.directTotalBeforeCents, 10000);
  assert.equal(receipt.compensationDetails.directCounterSubtotalCents, 3000);
  assert.equal(receipt.compensationDetails.groupSubtotalCents, 0);
  assert.equal(receipt.compensationDetails.adjustmentCents, 0);
  assert.equal(receipt.compensationDetails.directCounterItems[0].title, 'Uber');
  assert.equal(receipt.compensationDetails.directCounterItems[0].amountCents, 3000);
  assert.deepEqual(
    receipt.items.map(i => ({
      id: i.expenseId,
      comp: i.compensatedCents,
      now: i.settledNowCents,
      rem: i.remainingAfterCents,
      status: i.status,
    })),
    [
      { id: 'exp-1', comp: 3000, now: 3000, rem: 0, status: 'settled_now' },
      { id: 'exp-2', comp: 0, now: 1500, rem: 2500, status: 'partial_now' },
    ],
  );
  const totalOpenAfter = receipt.items.reduce((s, i) => s + i.remainingAfterCents, 0);
  assert.equal(totalOpenAfter, receipt.breakdown.remainingCents);
});

test('computeSettlementAttribution handles triangulated group simplification debt exceeding direct expenses', () => {
  const expenses = [
    {
      id: 'exp-hotel',
      description: 'Hotel',
      amount: 16000,
      payer_id: 'carol',
      split_mode: 'SUBSET_EQUAL',
      splits: [{ participant_id: 'alice' }, { participant_id: 'carol' }], // Alice owes Carol 8000
      created_at: '2026-11-10T10:00:00.000Z',
    },
    {
      id: 'exp-ingresso',
      description: 'Ingresso',
      amount: 16000,
      payer_id: 'bob',
      split_mode: 'SUBSET_EQUAL',
      splits: [{ participant_id: 'bob' }, { participant_id: 'carol' }], // Carol owes Bob 8000 -> Carol nets 0, Alice owes Bob 8000
      created_at: '2026-11-10T11:00:00.000Z',
    },
    {
      id: 'exp-lanche',
      description: 'Lanche',
      amount: 4000,
      payer_id: 'bob',
      split_mode: 'SUBSET_EQUAL',
      splits: [{ participant_id: 'alice' }, { participant_id: 'bob' }], // Alice owes Bob 2000 directly
      created_at: '2026-11-10T12:00:00.000Z',
    },
  ];
  const settlements = [
    {
      id: 'stl-1',
      from_participant_id: 'alice',
      to_participant_id: 'bob',
      amount: 6000, // 2000 direct + 4000 of 8000 group debt
      created_at: '2026-11-10T14:00:00.000Z',
    },
    {
      id: 'stl-2',
      from_participant_id: 'alice',
      to_participant_id: 'bob',
      amount: 4000, // settles remaining 4000 of group debt
      created_at: '2026-11-10T16:00:00.000Z',
    },
  ];

  const receipt = computeSettlementAttribution({
    settlementId: 'stl-1',
    participants,
    expenses,
    settlements,
  });

  assert.equal(receipt.breakdown.debtBeforeCents, 10000);
  assert.equal(receipt.groupDebtBeforeCents, 8000);
  assert.equal(receipt.groupSettledNowCents, 4000);
  assert.equal(receipt.groupRemainingAfterCents, 4000);
  assert.equal(receipt.groupDebtDetails.itemsSubtotalCents, 8000);
  assert.equal(receipt.groupDebtDetails.allocatedElsewhereCents, 0);
  assert.equal(receipt.groupDebtDetails.fromTotalDebtCents, 10000);
  assert.equal(receipt.groupDebtDetails.toTotalReceivableCents, 10000);
  assert.equal(receipt.groupDebtDetails.directOpenTotalBeforeCents, 2000);
  assert.equal(receipt.groupDebtDetails.otherCreditorsDebtCents, 0);
  assert.equal(receipt.groupDebtDetails.items[0].title, 'Hotel');
  assert.equal(receipt.groupDebtDetails.items[0].payer.id, 'carol');
  assert.equal(receipt.groupDebtDetails.items[0].amountCents, 8000);
  assert.equal(receipt.items[0].expenseId, 'exp-lanche');
  assert.equal(receipt.items[0].status, 'settled_now');
  assert.equal(receipt.items[0].remainingAfterCents, 0);
  assert.equal(
    receipt.items.reduce((s, i) => s + i.remainingAfterCents, 0) + receipt.groupRemainingAfterCents,
    receipt.breakdown.remainingCents,
  );

  const secondReceipt = computeSettlementAttribution({
    settlementId: 'stl-2',
    participants,
    expenses,
    settlements,
  });
  assert.equal(secondReceipt.groupDebtBeforeCents, 4000);
  assert.equal(secondReceipt.groupDebtDetails.itemsSubtotalCents, 4000);
  assert.equal(secondReceipt.groupDebtDetails.allocatedElsewhereCents, 0);
  assert.equal(secondReceipt.groupDebtDetails.fromTotalDebtCents, 4000);
  assert.equal(secondReceipt.groupDebtDetails.toTotalReceivableCents, 4000);
  assert.equal(secondReceipt.groupDebtDetails.items.length, 2); // Hotel +8000, prior group payment -4000
  assert.equal(secondReceipt.groupDebtDetails.items[1].amountCents, -4000);
});

test('computeSettlementAttribution exposes summarized totals when redirected debt splits across multiple creditors', () => {
  // Bob pays 200 for Alice; Alice pays 400 for Carol -> Carol owes 400 total (200 to Alice, 200 redirected to Bob)
  const expenses = [
    {
      id: 'exp-ab',
      description: 'Passeio',
      amount: 20000,
      payer_id: 'bob',
      split_mode: 'EXACT_AMOUNTS',
      splits: [{ participant_id: 'alice', allocated_amount: 20000 }],
      created_at: '2026-11-10T10:00:00.000Z',
    },
    {
      id: 'exp-ca',
      description: 'Diária',
      amount: 40000,
      payer_id: 'alice',
      split_mode: 'EXACT_AMOUNTS',
      splits: [{ participant_id: 'carol', allocated_amount: 40000 }],
      created_at: '2026-11-10T11:00:00.000Z',
    },
  ];
  const settlements = [
    {
      id: 'stl-cb',
      from_participant_id: 'carol',
      to_participant_id: 'bob',
      amount: 20000,
      created_at: '2026-11-10T12:00:00.000Z',
    },
  ];

  const receipt = computeSettlementAttribution({
    settlementId: 'stl-cb',
    participants,
    expenses,
    settlements,
  });

  assert.equal(receipt.items.length, 0);
  assert.equal(receipt.breakdown.debtBeforeCents, 20000);
  assert.equal(receipt.groupDebtBeforeCents, 20000);
  assert.equal(receipt.groupDebtDetails.fromTotalDebtCents, 40000);
  assert.equal(receipt.groupDebtDetails.toTotalReceivableCents, 20000);
  assert.equal(receipt.groupDebtDetails.directOpenTotalBeforeCents, 0);
  assert.equal(receipt.groupDebtDetails.otherCreditorsDebtCents, 20000);
});
