import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redistributeExpenseAfterRemoval } from '../src/domain/expenseRedistribution.js';
import { calculateBalances, getDirectPairBalances } from '../src/domain/settlement.js';
import { buildUnifiedFeed } from '../src/domain/feed.js';

test('redistributeExpenseAfterRemoval leaves EQUAL_ALL unchanged and ignores uninvolved splits', () => {
  const equalRes = redistributeExpenseAfterRemoval({
    expense: { id: 'e1', amount: 10000, split_mode: 'EQUAL_ALL', splits: [] },
    removedParticipantId: 'p2',
  });
  assert.equal(equalRes.action, 'unchanged');

  const uninvolvedRes = redistributeExpenseAfterRemoval({
    expense: {
      id: 'e2',
      amount: 10000,
      split_mode: 'SUBSET_EQUAL',
      splits: [{ participant_id: 'p1' }, { participant_id: 'p3' }],
    },
    removedParticipantId: 'p2',
  });
  assert.equal(uninvolvedRes.action, 'unchanged');
});

test('redistributeExpenseAfterRemoval marks single-participant split as delete_orphan', () => {
  const res = redistributeExpenseAfterRemoval({
    expense: {
      id: 'e3',
      amount: 4500,
      split_mode: 'EXACT_AMOUNTS',
      splits: [{ participant_id: 'p2', allocated_amount: 4500 }],
    },
    removedParticipantId: 'p2',
  });
  assert.equal(res.action, 'delete_orphan');
  assert.equal(res.removedCents, 4500);
});

test('redistributeExpenseAfterRemoval splits removed EXACT_AMOUNTS equally in cents', () => {
  // Total 10000: p1=5000, p2=3001, p3=1999. Remove p2 (3001 cents) -> +1501 to p1, +1500 to p3
  const res = redistributeExpenseAfterRemoval({
    expense: {
      id: 'e4',
      amount: 10000,
      split_mode: 'EXACT_AMOUNTS',
      splits: [
        { participant_id: 'p1', allocated_amount: 5000 },
        { participant_id: 'p2', allocated_amount: 3001 },
        { participant_id: 'p3', allocated_amount: 1999 },
      ],
    },
    removedParticipantId: 'p2',
  });
  assert.equal(res.action, 'update');
  assert.equal(res.nextSplitMode, 'EXACT_AMOUNTS');
  assert.deepEqual(res.nextSplits, [
    { participant_id: 'p1', allocated_amount: 6501, percentage: null, shares: null },
    { participant_id: 'p3', allocated_amount: 3499, percentage: null, shares: null },
  ]);
  assert.equal(res.nextSplits.reduce((s, x) => s + x.allocated_amount, 0), 10000);
});

test('redistributeExpenseAfterRemoval recalculates SHARES proportionally after equal cent redistribution', () => {
  // Total 10000: p1=2 shares (5000), p2=1 share (2500), p3=1 share (2500).
  // Remove p2 (2500) -> +1250 each -> p1=6250, p3=3750 -> gcd=1250 -> p1=5 shares, p3=3 shares
  const res = redistributeExpenseAfterRemoval({
    expense: {
      id: 'e5',
      amount: 10000,
      split_mode: 'SHARES',
      splits: [
        { participant_id: 'p1', shares: 2 },
        { participant_id: 'p2', shares: 1 },
        { participant_id: 'p3', shares: 1 },
      ],
    },
    removedParticipantId: 'p2',
  });
  assert.equal(res.action, 'update');
  assert.equal(res.nextSplitMode, 'SHARES');
  assert.deepEqual(res.nextSplits, [
    { participant_id: 'p1', allocated_amount: null, percentage: null, shares: 5 },
    { participant_id: 'p3', allocated_amount: null, percentage: null, shares: 3 },
  ]);

  const checkStats = calculateBalances(
    [{ id: 'p1', name: 'P1' }, { id: 'p3', name: 'P3' }],
    [{ id: 'e5', amount: 10000, payer_id: 'p1', split_mode: 'SHARES', splits: res.nextSplits }],
    [],
  );
  assert.equal(checkStats.get('p1').totalConsumed, 6250);
  assert.equal(checkStats.get('p3').totalConsumed, 3750);
});

test('redistributeExpenseAfterRemoval recalculates PERCENTAGES summing to 100 and preserving cents', () => {
  // Total 10000: p1=50%, p2=30%, p3=20%. Remove p2 (3000) -> +1500 each -> p1=6500 (65%), p3=3500 (35%)
  const res = redistributeExpenseAfterRemoval({
    expense: {
      id: 'e6',
      amount: 10000,
      split_mode: 'PERCENTAGES',
      splits: [
        { participant_id: 'p1', percentage: 50 },
        { participant_id: 'p2', percentage: 30 },
        { participant_id: 'p3', percentage: 20 },
      ],
    },
    removedParticipantId: 'p2',
  });
  assert.equal(res.action, 'update');
  assert.equal(res.nextSplitMode, 'PERCENTAGES');
  assert.equal(res.nextSplits[0].percentage, 65);
  assert.equal(res.nextSplits[1].percentage, 35);
});

test('getDirectPairBalances maps pay/receive/none obligations relative to payer', () => {
  const map = getDirectPairBalances(
    'p1',
    [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }],
    [
      { from: 'p1', to: 'p2', amount: 2500 },
      { from: 'p3', to: 'p1', amount: 4000 },
    ],
  );
  assert.deepEqual(map.get('p2'), { direction: 'pay', amount: 2500 });
  assert.deepEqual(map.get('p3'), { direction: 'receive', amount: 4000 });
  assert.deepEqual(map.get('p4'), { direction: 'none', amount: 0 });
});

test('buildUnifiedFeed sorts expenses, settlements, and timeline entries newest-first', () => {
  const feed = buildUnifiedFeed({
    expenses: [{ id: 'exp_1', created_at: '2026-11-15T10:00:00.000Z', payer_id: 'p1' }],
    settlements: [{ id: 'stl_1', created_at: '2026-11-15T12:00:00.000Z', from_participant_id: 'p2' }],
    timelineEvents: [{ id: 'tl_1', created_at: '2026-11-15T11:00:00.000Z', type: 'PARTICIPANT_LEFT' }],
  });
  assert.deepEqual(feed.map(item => item.id), ['stl_1', 'tl_1', 'exp_1']);
});
