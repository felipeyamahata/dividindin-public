import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSharesAllocation, deriveSharesFromAmounts } from '../src/domain/shares.js';

test('calculateSharesAllocation distributes exact cents with zero balance drift', () => {
  // Scenario: R$ 10,00 (1000 cents) between 3 participants with 1 share each
  const pIds = ['p1', 'p2', 'p3'];
  const shares = { p1: 1, p2: 1, p3: 1 };
  const alloc = calculateSharesAllocation(1000, pIds, shares);

  assert.equal(alloc.p1.share, 1);
  assert.equal(alloc.p1.totalShares, 3);
  assert.equal(alloc.p2.share, 1);
  assert.equal(alloc.p3.share, 1);

  const totalAllocated = alloc.p1.cents + alloc.p2.cents + alloc.p3.cents;
  assert.equal(totalAllocated, 1000, 'Sum of allocations must equal 1000 cents');
  assert.equal(alloc.p1.cents, 334);
  assert.equal(alloc.p2.cents, 333);
  assert.equal(alloc.p3.cents, 333);
});

test('calculateSharesAllocation handles pure fallback mode (empty sharesMap)', () => {
  const pIds = ['alice', 'bob', 'carol', 'dave'];
  const alloc = calculateSharesAllocation(4000, pIds, {});

  assert.equal(alloc.alice.isManual, false);
  assert.equal(alloc.alice.share, 1);
  assert.equal(alloc.alice.cents, 1000);
  assert.equal(alloc.alice.percentage, 25);
  assert.equal(alloc.bob.isManual, false);
  assert.equal(alloc.bob.cents, 1000);
  assert.equal(alloc.carol.cents, 1000);
  assert.equal(alloc.dave.cents, 1000);
});

test('calculateSharesAllocation handles mixed manual and fallback participants', () => {
  // Scenario: Alice manual with 5 parts, Bob/Carol/Dave fallback with 1 part (total 8 parts)
  const pIds = ['alice', 'bob', 'carol', 'dave'];
  const shares = { alice: 5 };
  const alloc = calculateSharesAllocation(4000, pIds, shares, 1);

  assert.equal(alloc.alice.isManual, true);
  assert.equal(alloc.alice.share, 5);
  assert.equal(alloc.alice.cents, 2500);

  assert.equal(alloc.bob.isManual, false);
  assert.equal(alloc.bob.share, 1);
  assert.equal(alloc.bob.cents, 500);

  assert.equal(alloc.carol.isManual, false);
  assert.equal(alloc.carol.cents, 500);

  assert.equal(alloc.dave.isManual, false);
  assert.equal(alloc.dave.cents, 500);

  const total = alloc.alice.cents + alloc.bob.cents + alloc.carol.cents + alloc.dave.cents;
  assert.equal(total, 4000);
});

test('deriveSharesFromAmounts distinguishes manual from fallback and simplifies ratios', () => {
  const pIds = ['alice', 'bob', 'carol', 'dave'];
  // Alice manual with 2500 cents, others fallback with 500 cents
  const { shares: s1, fallbackShare: fb1 } = deriveSharesFromAmounts(
    pIds,
    { alice: 2500, bob: 500, carol: 500, dave: 500 },
    4000,
    ['alice']
  );
  assert.deepEqual(s1, { alice: 5 });
  assert.equal(fb1, 1);

  // Alice manual with 1000 cents, Bob fallback with 4000 cents (2 people, total 5000)
  const { shares: s2, fallbackShare: fb2 } = deriveSharesFromAmounts(
    ['alice', 'bob'],
    { alice: 1000, bob: 4000 },
    5000,
    ['alice']
  );
  assert.deepEqual(s2, { alice: 1 });
  assert.equal(fb2, 4);

  // No one manual: returns empty shares and fallbackShare 1
  const { shares: s3, fallbackShare: fb3 } = deriveSharesFromAmounts(
    pIds,
    { alice: 1000, bob: 1000, carol: 1000, dave: 1000 },
    4000,
    []
  );
  assert.deepEqual(s3, {});
  assert.equal(fb3, 1);
});
