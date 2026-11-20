import { calculateBalances } from './settlement.js';

function gcd(a, b) {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function gcdAll(values) {
  let current = 0;
  for (const val of values) {
    if (val > 0) {
      current = current === 0 ? val : gcd(current, val);
    }
  }
  return current || 1;
}

/**
 * Computes recalculated split allocations when a participant is removed from an expense.
 * Splits the removed participant's allocated centavos equally among the remaining participants
 * of that expense, then recalculates mode-specific values (amounts, percentages, or shares).
 *
 * @param {object} params
 * @param {object} params.expense - Expense row with `id`, `amount`, `payer_id`, `split_mode`, and `splits`.
 * @param {string} params.removedParticipantId - Participant ID being removed.
 * @returns {{
 *   action: 'unchanged' | 'delete_orphan' | 'update',
 *   expenseId: string,
 *   nextSplitMode: string,
 *   nextSplits: Array<{ participant_id: string, allocated_amount: number|null, percentage: number|null, shares: number|null }>,
 *   removedCents: number,
 * }}
 */
export function redistributeExpenseAfterRemoval({ expense, removedParticipantId }) {
  const splitMode = expense.split_mode || 'EQUAL_ALL';
  const splits = Array.isArray(expense.splits) ? expense.splits : [];

  if (splitMode === 'EQUAL_ALL') {
    return {
      action: 'unchanged',
      expenseId: expense.id,
      nextSplitMode: 'EQUAL_ALL',
      nextSplits: [],
      removedCents: 0,
    };
  }

  const targetSplit = splits.find(s => s.participant_id === removedParticipantId);
  if (!targetSplit) {
    return {
      action: 'unchanged',
      expenseId: expense.id,
      nextSplitMode: splitMode,
      nextSplits: splits,
      removedCents: 0,
    };
  }

  const remainingSplits = splits.filter(s => s.participant_id !== removedParticipantId);
  if (remainingSplits.length === 0) {
    return {
      action: 'delete_orphan',
      expenseId: expense.id,
      nextSplitMode: splitMode,
      nextSplits: [],
      removedCents: Math.round(Number(expense.amount) || 0),
    };
  }

  if (splitMode === 'SUBSET_EQUAL') {
    return {
      action: 'update',
      expenseId: expense.id,
      nextSplitMode: 'SUBSET_EQUAL',
      nextSplits: remainingSplits.map(s => ({
        participant_id: s.participant_id,
        allocated_amount: null,
        percentage: null,
        shares: null,
      })),
      removedCents: Math.floor((Number(expense.amount) || 0) / splits.length),
    };
  }

  // Compute exact current centavo allocations using the canonical settlement engine
  const syntheticParticipants = splits.map(s => ({ id: s.participant_id, name: s.participant_id }));
  const stats = calculateBalances(syntheticParticipants, [{ ...expense, payer_id: '__external__' }], []);

  const removedCents = stats.get(removedParticipantId)?.totalConsumed || 0;
  const k = remainingSplits.length;
  const extraBase = Math.floor(removedCents / k);
  const extraRemainder = removedCents % k;

  const newCentsList = remainingSplits.map((s, idx) => {
    const currentCents = stats.get(s.participant_id)?.totalConsumed || 0;
    return currentCents + extraBase + (idx < extraRemainder ? 1 : 0);
  });

  if (splitMode === 'EXACT_AMOUNTS') {
    return {
      action: 'update',
      expenseId: expense.id,
      nextSplitMode: 'EXACT_AMOUNTS',
      nextSplits: remainingSplits.map((s, idx) => ({
        participant_id: s.participant_id,
        allocated_amount: newCentsList[idx],
        percentage: null,
        shares: null,
      })),
      removedCents,
    };
  }

  if (splitMode === 'PERCENTAGES') {
    const totalAmount = Math.max(1, Math.round(Number(expense.amount) || 0));
    const percentages = [];
    let runningSum = 0;

    for (let i = 0; i < remainingSplits.length; i++) {
      if (i === remainingSplits.length - 1) {
        percentages.push(Number(Math.max(0.000001, 100 - runningSum).toFixed(6)));
      } else {
        const rawPct = Math.max(0.000001, (newCentsList[i] / totalAmount) * 100);
        const rounded = Number(rawPct.toFixed(6));
        percentages.push(rounded);
        runningSum += rounded;
      }
    }

    return {
      action: 'update',
      expenseId: expense.id,
      nextSplitMode: 'PERCENTAGES',
      nextSplits: remainingSplits.map((s, idx) => ({
        participant_id: s.participant_id,
        allocated_amount: null,
        percentage: percentages[idx],
        shares: null,
      })),
      removedCents,
    };
  }

  // SHARES
  const g = gcdAll(newCentsList);
  let nextShares = newCentsList.map(cents => Math.max(1, Math.round(cents / g)));
  const maxShare = Math.max(...nextShares);
  if (maxShare > 1000000) {
    const divisor = maxShare / 1000000;
    nextShares = nextShares.map(val => Math.max(1, Math.round(val / divisor)));
  }

  return {
    action: 'update',
    expenseId: expense.id,
    nextSplitMode: 'SHARES',
    nextSplits: remainingSplits.map((s, idx) => ({
      participant_id: s.participant_id,
      allocated_amount: null,
      percentage: null,
      shares: nextShares[idx],
    })),
    removedCents,
  };
}
