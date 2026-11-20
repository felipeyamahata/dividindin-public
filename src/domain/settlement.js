/**
 * Pure Deterministic Settlement & Balancing Engine for Divide.
 * All amounts are strictly handled in integer cents (centavos).
 */

/**
 * Calculate net balances and individual financial stats for each participant.
 * 
 * @param {Array<{id: string, name: string}>} participants
 * @param {Array<{id: string, amount: number, payer_id: string, split_mode: string, splits?: Array<{participant_id: string, allocated_amount?: number, percentage?: number, shares?: number}>}>} expenses
 * @param {Array<{id: string, from_participant_id: string, to_participant_id: string, amount: number}>} settlements
 */
export function calculateBalances(participants = [], expenses = [], settlements = []) {
  const stats = new Map();

  for (const p of participants) {
    stats.set(p.id, {
      id: p.id,
      name: p.name,
      totalPaid: 0,
      totalConsumed: 0,
      paymentsSent: 0,
      paymentsReceived: 0,
      netPaid: 0,
      netBalance: 0,
    });
  }

  // 1. Process Expenses
  for (const expense of expenses) {
    const amount = Math.round(expense.amount);
    if (amount <= 0) continue;

    // Credit payer
    const payerStats = stats.get(expense.payer_id);
    if (payerStats) {
      payerStats.totalPaid += amount;
      payerStats.netBalance += amount;
    }

    // Debit consumers according to split_mode
    const splits = expense.splits || [];
    
    if (expense.split_mode === 'EQUAL_ALL') {
      // Dynamic split among all currently active participants
      const n = participants.length;
      if (n > 0) {
        const baseShare = Math.floor(amount / n);
        let remainder = amount % n;

        for (const p of participants) {
          const share = baseShare + (remainder > 0 ? 1 : 0);
          if (remainder > 0) remainder--;

          const pStats = stats.get(p.id);
          if (pStats) {
            pStats.totalConsumed += share;
            pStats.netBalance -= share;
          }
        }
      }
    } else if (expense.split_mode === 'SUBSET_EQUAL') {
      const activeSplits = splits.filter(s => stats.has(s.participant_id));
      const k = activeSplits.length;
      if (k > 0) {
        const baseShare = Math.floor(amount / k);
        let remainder = amount % k;

        for (const s of activeSplits) {
          const share = baseShare + (remainder > 0 ? 1 : 0);
          if (remainder > 0) remainder--;

          const pStats = stats.get(s.participant_id);
          if (pStats) {
            pStats.totalConsumed += share;
            pStats.netBalance -= share;
          }
        }
      }
    } else if (expense.split_mode === 'EXACT_AMOUNTS') {
      for (const s of splits) {
        const allocated = Math.round(s.allocated_amount || 0);
        const pStats = stats.get(s.participant_id);
        if (pStats && allocated > 0) {
          pStats.totalConsumed += allocated;
          pStats.netBalance -= allocated;
        }
      }
    } else if (expense.split_mode === 'PERCENTAGES') {
      const active = splits.filter(s => stats.has(s.participant_id));
      const allocations = active.map((s, index) => {
        const raw = amount * (s.percentage || 0) / 100;
        return { id: s.participant_id, base: Math.floor(raw), fraction: raw - Math.floor(raw), index };
      });
      let remainder = amount - allocations.reduce((sum, item) => sum + item.base, 0);
      allocations.sort((a, b) => b.fraction - a.fraction || a.index - b.index);
      for (let i = 0; i < remainder && i < allocations.length; i++) allocations[i].base++;
      for (const item of allocations) {
        const pStats = stats.get(item.id);
        pStats.totalConsumed += item.base;
        pStats.netBalance -= item.base;
      }
    } else if (expense.split_mode === 'SHARES') {
      const activeSplits = splits
        .filter(s => stats.has(s.participant_id) && Number(s.shares) > 0)
        .map(s => ({
          participant_id: s.participant_id,
          shares: Number(s.shares),
        }));

      const totalShares = activeSplits.reduce((sum, s) => sum + s.shares, 0);

      if (totalShares > 0) {
        let sumAllocated = 0;
        const allocations = activeSplits.map(s => {
          const raw = (amount * s.shares) / totalShares;
          const base = Math.floor(raw);
          const fraction = raw - base;
          sumAllocated += base;
          return { participant_id: s.participant_id, base, fraction };
        });

        let remainder = amount - sumAllocated;
        // Distribute remainder cents to highest fractional parts
        allocations.sort((a, b) => b.fraction - a.fraction);
        for (let i = 0; i < remainder; i++) {
          allocations[i % allocations.length].base += 1;
        }

        for (const alloc of allocations) {
          const pStats = stats.get(alloc.participant_id);
          if (pStats) {
            pStats.totalConsumed += alloc.base;
            pStats.netBalance -= alloc.base;
          }
        }
      }
    }
  }

  // 2. Process Settlements (Real payments made between participants)
  for (const settlement of settlements) {
    const amount = Math.round(settlement.amount);
    if (amount <= 0) continue;

    const fromStats = stats.get(settlement.from_participant_id);
    const toStats = stats.get(settlement.to_participant_id);

    // The sender parted with money: their net balance increases (debt reduced or credit gained)
    if (fromStats) {
      fromStats.paymentsSent += amount;
      fromStats.netBalance += amount;
    }

    // The receiver received money: their net balance decreases (credit redeemed or debt increased)
    if (toStats) {
      toStats.paymentsReceived += amount;
      toStats.netBalance -= amount;
    }
  }

  for (const item of stats.values()) {
    item.netPaid = item.totalPaid + item.paymentsSent - item.paymentsReceived;
  }

  return stats;
}

/**
 * Find a minimum transaction count for up to 12 nonzero balances.
 * Larger groups use a bounded greedy fallback.
 * 
 * @param {Map<string, {id: string, name: string, netBalance: number}>} statsMap
 * @returns {Array<{from: string, fromName: string, to: string, toName: string, amount: number}>}
 */
export function simplifyDebts(statsMap, optimize = true) {
  const active = [...statsMap.values()].filter(item => item.netBalance !== 0);
  if (optimize && active.length > 1 && active.length <= 12 && active.every(item => Number.isSafeInteger(item.netBalance)) && active.reduce((sum, item) => sum + item.netBalance, 0) === 0) {
    const size = 1 << active.length;
    const sums = new Array(size).fill(0);
    for (let mask = 1; mask < size; mask++) {
      const bit = mask & -mask;
      sums[mask] = sums[mask ^ bit] + active[31 - Math.clz32(bit)].netBalance;
    }
    const memo = new Map([[0, []]]);
    function partition(mask) {
      if (memo.has(mask)) return memo.get(mask);
      const first = mask & -mask;
      let best = null;
      for (let sub = mask; sub; sub = (sub - 1) & mask) {
        if (!(sub & first) || sums[sub] !== 0) continue;
        const rest = partition(mask ^ sub);
        if (rest && (!best || rest.length + 1 > best.length)) best = [sub, ...rest];
      }
      memo.set(mask, best);
      return best;
    }
    const groups = partition(size - 1);
    if (groups) return groups.flatMap(mask => simplifyDebts(new Map(active.filter((_, i) => mask & (1 << i)).map(item => [item.id, item])), false));
  }
  const debtors = [];
  const creditors = [];

  for (const item of statsMap.values()) {
    if (item.netBalance < -0.001) {
      debtors.push({ id: item.id, name: item.name, balance: item.netBalance });
    } else if (item.netBalance > 0.001) {
      creditors.push({ id: item.id, name: item.name, balance: item.netBalance });
    }
  }

  // Sort: Debtors ascending (most negative first), Creditors descending (most positive first)
  debtors.sort((a, b) => a.balance - b.balance);
  creditors.sort((a, b) => b.balance - a.balance);

  const transactions = [];
  let dIdx = 0;
  let cIdx = 0;

  while (dIdx < debtors.length && cIdx < creditors.length) {
    const debtor = debtors[dIdx];
    const creditor = creditors[cIdx];

    const debt = Math.abs(debtor.balance);
    const credit = creditor.balance;
    const transfer = Math.min(debt, credit);

    if (transfer > 0) {
      transactions.push({
        from: debtor.id,
        fromName: debtor.name,
        to: creditor.id,
        toName: creditor.name,
        amount: Math.round(transfer),
      });
    }

    debtor.balance += transfer;
    creditor.balance -= transfer;

    if (Math.abs(debtor.balance) < 0.5) dIdx++;
    if (Math.abs(creditor.balance) < 0.5) cIdx++;
  }

  return transactions;
}

/**
 * Compile a personalized summary for a specific participant.
 */
export function getParticipantSummary(participantId, statsMap, simplifiedTransactions) {
  const userStats = statsMap.get(participantId) || {
    id: participantId,
    name: '',
    totalPaid: 0,
    totalConsumed: 0,
    paymentsSent: 0,
    paymentsReceived: 0,
    netPaid: 0,
    netBalance: 0,
  };

  const toPay = simplifiedTransactions.filter(t => t.from === participantId);
  const toReceive = simplifiedTransactions.filter(t => t.to === participantId);

  return {
    ...userStats,
    toPay,
    toReceive,
    allTransactions: simplifiedTransactions,
  };
}

/**
 * Computes directional obligation between `payerId` and every other participant
 * based on the simplified settlement graph.
 *
 * @param {string} payerId
 * @param {Array<{id: string}>} participants
 * @param {Array<{from: string, to: string, amount: number}>} simplifiedTransactions
 * @returns {Map<string, { direction: 'pay' | 'receive' | 'none', amount: number }>}
 */
export function getDirectPairBalances(payerId, participants = [], simplifiedTransactions = []) {
  const result = new Map();
  if (!payerId) return result;

  for (const person of participants) {
    if (!person?.id || person.id === payerId) continue;
    const toPay = simplifiedTransactions.find(tx => tx.from === payerId && tx.to === person.id);
    if (toPay && toPay.amount > 0) {
      result.set(person.id, { direction: 'pay', amount: toPay.amount });
      continue;
    }
    const toReceive = simplifiedTransactions.find(tx => tx.from === person.id && tx.to === payerId);
    if (toReceive && toReceive.amount > 0) {
      result.set(person.id, { direction: 'receive', amount: toReceive.amount });
      continue;
    }
    result.set(person.id, { direction: 'none', amount: 0 });
  }

  return result;
}

/**
 * Decomposes a settlement payment into settled debt vs generated credit.
 */
export function decomposeSettlementAmount(amountCents, debtBeforeCents = 0) {
  const amount = Math.max(0, Math.round(Number(amountCents) || 0));
  const debtBefore = Math.max(0, Math.round(Number(debtBeforeCents) || 0));
  const settledCents = Math.min(amount, debtBefore);
  const creditedCents = Math.max(0, amount - debtBefore);
  const remainingCents = Math.max(0, debtBefore - amount);
  return {
    amountCents: amount,
    debtBeforeCents: debtBefore,
    settledCents,
    creditedCents,
    remainingCents,
  };
}

/**
 * Computes how much `fromParticipantId` owed `toParticipantId` immediately before
 * recording a new settlement, according to the simplified debt graph.
 */
export function getPairDebtBeforeSettlement({
  participants = [],
  expenses = [],
  settlements = [],
  fromParticipantId,
  toParticipantId,
}) {
  if (!fromParticipantId || !toParticipantId || fromParticipantId === toParticipantId) return 0;
  const statsMap = calculateBalances(participants, expenses, settlements);
  const simplifiedTransactions = simplifyDebts(statsMap);
  const pairBalances = getDirectPairBalances(fromParticipantId, participants, simplifiedTransactions);
  const obligation = pairBalances.get(toParticipantId);
  return obligation?.direction === 'pay' ? obligation.amount : 0;
}

function toTimestampMs(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Computes `{ debtBeforeCents, settledCents, creditedCents }` for each settlement
 * dynamically by replaying only expenses and settlements strictly prior to it
 * in chronological order. Later entries never affect an earlier settlement, while
 * edits or deletions of earlier entries automatically recalculate it.
 */
export function computeSettlementBreakdowns({
  participants = [],
  expenses = [],
  settlements = [],
} = {}) {
  const result = new Map();
  if (!settlements.length) return result;

  const timeline = [
    ...expenses.map(expense => ({ kind: 'expense', created_at: expense.created_at, id: expense.id, data: expense })),
    ...settlements.map(settlement => ({ kind: 'settlement', created_at: settlement.created_at, id: settlement.id, data: settlement })),
  ].sort((a, b) => {
    const diff = toTimestampMs(a.created_at) - toTimestampMs(b.created_at);
    if (diff !== 0) return diff;
    if (a.kind !== b.kind) return a.kind === 'expense' ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });

  const appliedExpenses = [];
  const appliedSettlements = [];

  for (const item of timeline) {
    if (item.kind === 'expense') {
      appliedExpenses.push(item.data);
      continue;
    }

    const s = item.data;
    const debtBefore = getPairDebtBeforeSettlement({
      participants,
      expenses: appliedExpenses,
      settlements: appliedSettlements,
      fromParticipantId: s.from_participant_id,
      toParticipantId: s.to_participant_id,
    });

    result.set(s.id, decomposeSettlementAmount(s.amount, debtBefore));
    appliedSettlements.push(s);
  }

  return result;
}
