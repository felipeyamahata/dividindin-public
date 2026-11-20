import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateBalances,
  simplifyDebts,
  getParticipantSummary,
  decomposeSettlementAmount,
  getPairDebtBeforeSettlement,
  computeSettlementBreakdowns,
} from '../src/domain/settlement.js';

test('Scenario 1: Simple Equal Split between Alice and Bob', () => {
  const participants = [
    { id: 'p_alice', name: 'Alice' },
    { id: 'p_bob', name: 'Bob' },
  ];

  // Alice pays R$ 100,00 (10000 cents) split equally
  const expenses = [
    {
      id: 'e1',
      amount: 10000,
      payer_id: 'p_alice',
      split_mode: 'EQUAL_ALL',
    },
  ];

  const stats = calculateBalances(participants, expenses, []);
  assert.equal(stats.get('p_alice').netBalance, 5000);
  assert.equal(stats.get('p_bob').netBalance, -5000);

  const txs = simplifyDebts(stats);
  assert.equal(txs.length, 1);
  assert.deepEqual(txs[0], {
    from: 'p_bob',
    fromName: 'Bob',
    to: 'p_alice',
    toName: 'Alice',
    amount: 5000,
  });
});

test('Scenario 2: Dynamic Split when new participant joins later', () => {
  // Originally 2 participants
  const participants3 = [
    { id: 'p_alice', name: 'Alice' },
    { id: 'p_bob', name: 'Bob' },
    { id: 'p_carol', name: 'Carol' }, // Carol joins later!
  ];

  // Expense was logged as EQUAL_ALL
  const expenses = [
    {
      id: 'e1',
      amount: 9000, // R$ 90,00
      payer_id: 'p_alice',
      split_mode: 'EQUAL_ALL',
    },
  ];

  // With 3 participants, R$ 90 is dynamically R$ 30 each instead of R$ 45
  const stats = calculateBalances(participants3, expenses, []);
  assert.equal(stats.get('p_alice').netBalance, 6000); // paid 9000, consumed 3000
  assert.equal(stats.get('p_bob').netBalance, -3000);
  assert.equal(stats.get('p_carol').netBalance, -3000);

  const txs = simplifyDebts(stats);
  assert.equal(txs.length, 2);
  const totalReceivedByAlice = txs.filter(t => t.to === 'p_alice').reduce((sum, t) => sum + t.amount, 0);
  assert.equal(totalReceivedByAlice, 6000);
});

test('Scenario 3: Self-healing reconciliation when paying the wrong person', () => {
  const participants = [
    { id: 'p_alice', name: 'Alice' },
    { id: 'p_bob', name: 'Bob' },
    { id: 'p_carol', name: 'Carol' },
  ];

  // Alice paid R$ 150,00 (50 each)
  const expenses = [
    { id: 'e1', amount: 15000, payer_id: 'p_alice', split_mode: 'EQUAL_ALL' },
  ];

  // Bob owed Alice R$ 50, but accidentally sent R$ 50 to Carol!
  const settlements = [
    {
      id: 's1',
      from_participant_id: 'p_bob',
      to_participant_id: 'p_carol',
      amount: 5000,
    },
  ];

  const stats = calculateBalances(participants, expenses, settlements);

  // Bob paid 5000 in settlement, consumed 5000: Net = 0! (Bob is square!)
  assert.equal(stats.get('p_bob').netBalance, 0);

  // Carol consumed 5000, received 5000: now Carol owes 10000! (-5000 - 5000)
  assert.equal(stats.get('p_carol').netBalance, -10000);

  // Alice paid 15000, consumed 5000: Alice is owed 10000!
  assert.equal(stats.get('p_alice').netBalance, 10000);

  // Simplified transactions now cleanly re-route Carol to pay Alice directly:
  const txs = simplifyDebts(stats);
  assert.equal(txs.length, 1);
  assert.equal(txs[0].from, 'p_carol');
  assert.equal(txs[0].to, 'p_alice');
  assert.equal(txs[0].amount, 10000);
});

test('Scenario 4: Partial and Overpayments', () => {
  const participants = [
    { id: 'p1', name: 'User 1' },
    { id: 'p2', name: 'User 2' },
  ];

  // User 1 paid R$ 100 (50 each)
  const expenses = [
    { id: 'e1', amount: 10000, payer_id: 'p1', split_mode: 'EQUAL_ALL' },
  ];

  // User 2 owes R$ 50, but accidentally sends R$ 70 to User 1
  const settlements = [
    { id: 's1', from_participant_id: 'p2', to_participant_id: 'p1', amount: 7000 },
  ];

  const stats = calculateBalances(participants, expenses, settlements);
  // User 2 now has a credit of R$ 20 (+2000)
  assert.equal(stats.get('p2').netBalance, 2000);
  // User 1 now owes R$ 20 (-2000)
  assert.equal(stats.get('p1').netBalance, -2000);

  const txs = simplifyDebts(stats);
  assert.equal(txs.length, 1);
  assert.equal(txs[0].from, 'p1');
  assert.equal(txs[0].to, 'p2');
  assert.equal(txs[0].amount, 2000);
});

test('Scenario 5: Odd centavo distribution ensures zero balance drift', () => {
  const participants = [
    { id: 'p1', name: 'P1' },
    { id: 'p2', name: 'P2' },
    { id: 'p3', name: 'P3' },
  ];

  // R$ 10,00 split among 3 = 334, 333, 333 cents
  const expenses = [
    { id: 'e1', amount: 1000, payer_id: 'p1', split_mode: 'EQUAL_ALL' },
  ];

  const stats = calculateBalances(participants, expenses, []);
  let totalNet = 0;
  for (const s of stats.values()) {
    totalNet += s.netBalance;
  }
  // Sum of all net balances MUST equal strictly 0
  assert.equal(totalNet, 0);
});

test('Scenario 6: Fractional Shares Split (Partes / Frações)', () => {
  const participants = [
    { id: 'p_a', name: 'Pessoa A' },
    { id: 'p_b', name: 'Pessoa B' },
    { id: 'p_c', name: 'Pessoa C' },
    { id: 'p_d', name: 'Pessoa D' },
  ];

  // Pessoa A pays R$ 100,00 (10000 cents)
  // Shares: A=1, B=3, C=2, D=4 => Total: 10 parts
  const expenses = [
    {
      id: 'e_shares',
      amount: 10000,
      payer_id: 'p_a',
      split_mode: 'SHARES',
      splits: [
        { participant_id: 'p_a', shares: 1 },
        { participant_id: 'p_b', shares: 3 },
        { participant_id: 'p_c', shares: 2 },
        { participant_id: 'p_d', shares: 4 },
      ],
    },
  ];

  const stats = calculateBalances(participants, expenses, []);

  // Consumed: A=1000 (1/10), B=3000 (3/10), C=2000 (2/10), D=4000 (4/10)
  assert.equal(stats.get('p_a').totalConsumed, 1000);
  assert.equal(stats.get('p_b').totalConsumed, 3000);
  assert.equal(stats.get('p_c').totalConsumed, 2000);
  assert.equal(stats.get('p_d').totalConsumed, 4000);

  // Net balances: A paid 10000, consumed 1000 => Net = +9000
  assert.equal(stats.get('p_a').netBalance, 9000);
  assert.equal(stats.get('p_b').netBalance, -3000);
  assert.equal(stats.get('p_c').netBalance, -2000);
  assert.equal(stats.get('p_d').netBalance, -4000);

  // Sum of net balances MUST be 0
  let totalNet = 0;
  for (const s of stats.values()) totalNet += s.netBalance;
  assert.equal(totalNet, 0);
});


test('Percentage allocation never gives a participant a negative cent', () => {
  const people = ['a', 'b', 'c', 'd'].map(id => ({ id, name: id }));
  const balances = calculateBalances(people, [{ payer_id: 'a', amount: 2, split_mode: 'PERCENTAGES', splits: people.map(p => ({ participant_id: p.id, percentage: 25 })) }]);
  assert.deepEqual([...balances.values()].map(p => p.totalConsumed), [1, 1, 0, 0]);
  assert.equal([...balances.values()].reduce((sum, p) => sum + p.netBalance, 0), 0);
});


test('Simplification finds the minimum number of transfers for small groups', () => {
  const values = [-8, -7, -5, 10, 8, 2];
  const balances = new Map(values.map((netBalance, i) => [String(i), { id: String(i), name: String(i), netBalance }]));
  assert.equal(simplifyDebts(balances).length, 4);
});

test('netPaid reflects direct payments sent and received with and without expenses', () => {
  const participants = [
    { id: 'p_felipe', name: 'Felipe' },
    { id: 'p_carlos', name: 'Carlos' },
  ];

  // Scenario A: Direct payment without prior expenses (Felipe sends R$ 50 to Carlos)
  const directOnly = calculateBalances(participants, [], [
    { id: 's1', from_participant_id: 'p_felipe', to_participant_id: 'p_carlos', amount: 5000 },
  ]);
  const felipeDirect = getParticipantSummary('p_felipe', directOnly, simplifyDebts(directOnly));
  const carlosDirect = getParticipantSummary('p_carlos', directOnly, simplifyDebts(directOnly));

  assert.equal(felipeDirect.totalPaid, 0);
  assert.equal(felipeDirect.netPaid, 5000);
  assert.equal(felipeDirect.totalConsumed, 0);
  assert.equal(felipeDirect.netBalance, 5000);

  assert.equal(carlosDirect.totalPaid, 0);
  assert.equal(carlosDirect.netPaid, -5000);
  assert.equal(carlosDirect.totalConsumed, 0);
  assert.equal(carlosDirect.netBalance, -5000);

  // Scenario B: Expense R$ 100 paid by Felipe split 50/50 + R$ 50 settlement from Carlos to Felipe
  const settled = calculateBalances(
    participants,
    [{ id: 'e1', amount: 10000, payer_id: 'p_felipe', split_mode: 'EQUAL_ALL' }],
    [{ id: 's2', from_participant_id: 'p_carlos', to_participant_id: 'p_felipe', amount: 5000 }],
  );
  assert.equal(settled.get('p_felipe').netPaid, 5000);
  assert.equal(settled.get('p_felipe').totalConsumed, 5000);
  assert.equal(settled.get('p_felipe').netBalance, 0);
  assert.equal(settled.get('p_carlos').netPaid, 5000);
  assert.equal(settled.get('p_carlos').totalConsumed, 5000);
  assert.equal(settled.get('p_carlos').netBalance, 0);
});

test('decomposeSettlementAmount and computeSettlementBreakdowns replay chronologically ignoring later entries and reflecting prior edits', () => {
  assert.deepEqual(decomposeSettlementAmount(5000, 2000), {
    amountCents: 5000,
    debtBeforeCents: 2000,
    settledCents: 2000,
    creditedCents: 3000,
    remainingCents: 0,
  });
  assert.deepEqual(decomposeSettlementAmount(5000, 5967), {
    amountCents: 5000,
    debtBeforeCents: 5967,
    settledCents: 5000,
    creditedCents: 0,
    remainingCents: 967,
  });
  assert.deepEqual(decomposeSettlementAmount(2000, 2000), {
    amountCents: 2000,
    debtBeforeCents: 2000,
    settledCents: 2000,
    creditedCents: 0,
    remainingCents: 0,
  });
  assert.deepEqual(decomposeSettlementAmount(5000, 0), {
    amountCents: 5000,
    debtBeforeCents: 0,
    settledCents: 0,
    creditedCents: 5000,
    remainingCents: 0,
  });

  const participants = [
    { id: 'p_felipe', name: 'Felipe' },
    { id: 'p_carlos', name: 'Carlos' },
  ];

  // Expenses AFTER s1 (21:00) do not affect s1 (20:51); chained settlements update subsequent debt
  const initialReplay = computeSettlementBreakdowns({
    participants,
    expenses: [
      { id: 'e1', amount: 4000, payer_id: 'p_carlos', split_mode: 'EQUAL_ALL', created_at: '2026-11-16T20:00:00.000Z' },
      { id: 'e2', amount: 20000, payer_id: 'p_carlos', split_mode: 'EQUAL_ALL', created_at: '2026-11-16T21:00:00.000Z' },
    ],
    settlements: [
      { id: 's1', from_participant_id: 'p_felipe', to_participant_id: 'p_carlos', amount: 5000, created_at: '2026-11-16T20:51:00.000Z' },
      { id: 's2', from_participant_id: 'p_carlos', to_participant_id: 'p_felipe', amount: 1000, created_at: '2026-11-16T20:55:00.000Z' },
    ],
  });
  assert.deepEqual(initialReplay.get('s1'), {
    amountCents: 5000,
    debtBeforeCents: 2000,
    settledCents: 2000,
    creditedCents: 3000,
    remainingCents: 0,
  });
  assert.deepEqual(initialReplay.get('s2'), {
    amountCents: 1000,
    debtBeforeCents: 3000,
    settledCents: 1000,
    creditedCents: 0,
    remainingCents: 2000,
  });

  // Editing an earlier expense (e1: R$ 40 -> R$ 100) dynamically recalculates s1 (devia R$ 50, quitou R$ 50, creditou R$ 0, resta R$ 0)
  const afterPriorEdit = computeSettlementBreakdowns({
    participants,
    expenses: [
      { id: 'e1', amount: 10000, payer_id: 'p_carlos', split_mode: 'EQUAL_ALL', created_at: '2026-11-16T20:00:00.000Z' },
      { id: 'e2', amount: 20000, payer_id: 'p_carlos', split_mode: 'EQUAL_ALL', created_at: '2026-11-16T21:00:00.000Z' },
    ],
    settlements: [
      { id: 's1', from_participant_id: 'p_felipe', to_participant_id: 'p_carlos', amount: 5000, created_at: '2026-11-16T20:51:00.000Z' },
    ],
  });
  assert.deepEqual(afterPriorEdit.get('s1'), {
    amountCents: 5000,
    debtBeforeCents: 5000,
    settledCents: 5000,
    creditedCents: 0,
    remainingCents: 0,
  });

  assert.equal(
    getPairDebtBeforeSettlement({
      participants,
      expenses: [{ id: 'e1', amount: 4000, payer_id: 'p_carlos', split_mode: 'EQUAL_ALL' }],
      settlements: [],
      fromParticipantId: 'p_felipe',
      toParticipantId: 'p_carlos',
    }),
    2000,
  );
});
