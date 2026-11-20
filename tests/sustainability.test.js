import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMonthlySustainabilitySnapshot,
  convertCostItemToMonthlyBrlCents,
  formatMonthLabelPt,
  getCurrentMonthKey,
  validateCostItemInput,
  validateDonationAmountCents,
} from '../src/domain/sustainability.js';
import { createUsdRateProvider, parseAwesomeUsdBrlResponse } from '../src/domain/usdRate.js';

test('getCurrentMonthKey and formatMonthLabelPt format Sao Paulo month correctly', () => {
  const sample = new Date('2026-11-15T23:30:00.000Z');
  assert.equal(getCurrentMonthKey(sample), '2026-11');
  assert.equal(formatMonthLabelPt('2026-11'), 'novembro de 2026');
});

test('convertCostItemToMonthlyBrlCents handles BRL, USD, monthly, and annual costs', () => {
  assert.equal(
    convertCostItemToMonthlyBrlCents({ amountCents: 3500, currency: 'BRL', billingCycle: 'monthly' }, 5.5),
    3500
  );
  assert.equal(
    convertCostItemToMonthlyBrlCents({ amountCents: 1200, currency: 'USD', billingCycle: 'annual' }, 5.5),
    Math.round((1200 * 5.5) / 12)
  );
});

test('computeMonthlySustainabilitySnapshot computes goal, remaining, surplus, and clamped progress', () => {
  const snapshot = computeMonthlySustainabilitySnapshot({
    monthKey: '2026-11',
    usdToBrlRate: 6.0,
    rateSource: 'auto-live',
    pixEnabled: true,
    confirmedCents: 4500,
    costs: [
      { id: '1', label: 'Domínio .com', amount_cents: 1200, currency: 'USD', billing_cycle: 'annual', is_active: 1 },
      { id: '2', label: 'Energia S10e', amount_cents: 3000, currency: 'BRL', billing_cycle: 'monthly', is_active: 1 },
      { id: '3', label: 'Inativo', amount_cents: 9900, currency: 'BRL', billing_cycle: 'monthly', is_active: 0 },
    ],
  });

  // Domínio: 1200 cents USD * 6.0 / 12 = 600 cents BRL; Energia: 3000 -> total 3600
  assert.equal(snapshot.goalCents, 3600);
  assert.equal(snapshot.confirmedCents, 4500);
  assert.equal(snapshot.remainingCents, 0);
  assert.equal(snapshot.surplusCents, 900);
  assert.equal(snapshot.isGoalCovered, true);
  assert.equal(snapshot.rawPercent, 125);
  assert.equal(snapshot.clampedPercent, 100);
  assert.equal(snapshot.costs.length, 2);
});

test('validation helpers enforce bounds on donation and cost inputs', () => {
  assert.equal(validateDonationAmountCents(500), 500);
  assert.throws(() => validateDonationAmountCents(50));
  assert.throws(() => validateDonationAmountCents(10.5));

  const validCost = validateCostItemInput({
    label: '  Domínio .com  ',
    amountCents: 1400,
    currency: 'usd',
    billingCycle: 'ANNUAL',
  });
  assert.deepEqual(validCost, {
    label: 'Domínio .com',
    amountCents: 1400,
    currency: 'USD',
    billingCycle: 'annual',
    sortOrder: 0,
    isActive: true,
  });
  assert.throws(() => validateCostItemInput({ label: '', amountCents: 100 }));
  assert.throws(() => validateCostItemInput({ label: 'Teste', amountCents: 100, currency: 'EUR' }));
});

test('createUsdRateProvider caches live rate and falls back cleanly on fetch error', async () => {
  assert.equal(parseAwesomeUsdBrlResponse({ USDBRL: { bid: '5.7345' } }), 5.7345);
  assert.equal(parseAwesomeUsdBrlResponse({ USDBRL: { bid: 'invalid' } }), null);

  let calls = 0;
  let saved = null;
  const provider = createUsdRateProvider({
    ttlMs: 10_000,
    fetcher: async () => {
      calls += 1;
      return { USDBRL: { bid: '5.92' } };
    },
  });

  const first = await provider.resolveRate({
    useAuto: true,
    fallbackRate: 5.5,
    nowMs: 1_000,
    onRateFetched: (rate, iso) => { saved = { rate, iso }; },
  });
  assert.equal(first.rate, 5.92);
  assert.equal(first.source, 'auto-live');
  assert.equal(saved.rate, 5.92);

  const cached = await provider.resolveRate({ useAuto: true, fallbackRate: 5.5, nowMs: 5_000 });
  assert.equal(cached.rate, 5.92);
  assert.equal(cached.source, 'auto-cache');
  assert.equal(calls, 1);

  const failingProvider = createUsdRateProvider({
    fetcher: async () => { throw new Error('offline'); },
  });
  const fallback = await failingProvider.resolveRate({ useAuto: true, fallbackRate: 5.45 });
  assert.equal(fallback.rate, 5.45);
  assert.equal(fallback.source, 'fallback');
});
