import { calculateBalances, computeSettlementBreakdowns } from './settlement.js';

function toTimestampMs(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function compareTimelineEntries(a, b) {
  const diff = toTimestampMs(a.created_at) - toTimestampMs(b.created_at);
  if (diff !== 0) return diff;
  if (a.kind !== b.kind) return a.kind === 'expense' ? -1 : 1;
  return String(a.id).localeCompare(String(b.id));
}

function getParticipantExpenseShare(participants, expense, participantId) {
  if (!participantId || !expense || Math.round(expense.amount || 0) <= 0) return 0;
  const stats = calculateBalances(participants, [expense]);
  return stats.get(participantId)?.totalConsumed || 0;
}

function allocateFifo(poolCents, items, getRemaining) {
  let remaining = Math.max(0, Math.round(poolCents || 0));
  const allocated = new Array(items.length).fill(0);
  if (remaining <= 0) return { allocated, leftoverCents: 0 };

  for (let i = 0; i < items.length && remaining > 0; i++) {
    const openCents = Math.max(0, getRemaining(items[i], i));
    if (openCents <= 0) continue;
    const take = Math.min(remaining, openCents);
    allocated[i] = take;
    remaining -= take;
  }

  return { allocated, leftoverCents: remaining };
}

function resolveAttributionStatus({
  participantShareCents,
  settledPriorCents,
  compensatedCents,
  settledNowCents,
  remainingAfterCents,
}) {
  if (remainingAfterCents === 0) {
    if (settledNowCents > 0) return 'settled_now';
    if (settledPriorCents > 0) return 'settled_prior';
    return 'compensated';
  }
  if (settledNowCents > 0) return 'partial_now';
  if (settledPriorCents > 0 || compensatedCents > 0) return 'partial_prior';
  return 'open';
}

function toParticipantRef(participantById, participantId, fallbackName = '') {
  const found = participantById.get(participantId);
  if (found) {
    return { id: found.id, name: found.name, user_id: found.user_id ?? null };
  }
  return { id: participantId, name: fallbackName, user_id: null };
}

function buildReconciliationDetails({
  participants = [],
  priorEntries = [],
  breakdowns,
  fromId,
  toId,
  directOpenTotalBeforeCents,
  debtBeforeCents,
  mutualOffsetCents,
  groupDebtBeforeCents,
}) {
  if (mutualOffsetCents <= 0 && groupDebtBeforeCents <= 0) {
    return { compensationDetails: null, groupDebtDetails: null };
  }

  const priorExpenses = [];
  const priorSettlements = [];
  for (const entry of priorEntries) {
    if (entry.kind === 'expense') priorExpenses.push(entry.data);
    else priorSettlements.push(entry.data);
  }
  const statsBefore = calculateBalances(participants, priorExpenses, priorSettlements);
  const fromTotalDebtCents = Math.max(0, -(statsBefore.get(fromId)?.netBalance || 0));
  const toTotalReceivableCents = Math.max(0, statsBefore.get(toId)?.netBalance || 0);

  const participantById = new Map(participants.map(p => [p.id, p]));
  const directCounterItems = [];
  const groupItems = [];

  for (const entry of priorEntries) {
    if (entry.kind === 'expense') {
      const expense = entry.data;
      if (Math.round(expense.amount || 0) <= 0) continue;

      if (expense.payer_id === fromId) {
        const stats = calculateBalances(participants, [expense]);
        const toShare = stats.get(toId)?.totalConsumed || 0;
        if (toShare > 0) {
          directCounterItems.push({
            id: `${expense.id}:to`,
            kind: 'expense',
            title: expense.description,
            createdAt: expense.created_at,
            amountCents: toShare,
            counterparties: [toParticipantRef(participantById, toId)],
          });
        }

        const thirdParties = [];
        let thirdPartyTotal = 0;
        for (const p of participants) {
          if (p.id === fromId || p.id === toId) continue;
          const share = stats.get(p.id)?.totalConsumed || 0;
          if (share > 0) {
            thirdPartyTotal += share;
            thirdParties.push(toParticipantRef(participantById, p.id, p.name));
          }
        }
        if (thirdPartyTotal > 0) {
          groupItems.push({
            id: `${expense.id}:others`,
            kind: 'expense_paid',
            title: expense.description,
            createdAt: expense.created_at,
            amountCents: thirdPartyTotal,
            counterparties: thirdParties,
            payer: toParticipantRef(participantById, fromId),
          });
        }
      } else if (expense.payer_id !== toId) {
        const fromShare = getParticipantExpenseShare(participants, expense, fromId);
        if (fromShare > 0) {
          groupItems.push({
            id: `${expense.id}:consumed`,
            kind: 'expense_consumed',
            title: expense.description,
            createdAt: expense.created_at,
            amountCents: -fromShare,
            payer: toParticipantRef(participantById, expense.payer_id, expense.payer_name),
            counterparties: [],
          });
        }
      }
      continue;
    }

    const s = entry.data;
    const amount = Math.round(s.amount || 0);
    if (amount <= 0) continue;

    if (s.from_participant_id === fromId && s.to_participant_id === toId) {
      const sBreakdown = breakdowns.get(s.id);
      const credited = sBreakdown ? sBreakdown.creditedCents : 0;
      const groupSettled = entry.groupSettledCents || 0;
      if (groupSettled > 0) {
        directCounterItems.push({
          id: `${s.id}:group-settled`,
          kind: 'prior_group_payment',
          title: 'pagamento anterior no acerto de grupo',
          createdAt: s.created_at,
          amountCents: groupSettled,
          counterparties: [toParticipantRef(participantById, toId, s.to_name)],
        });
      }
      if (credited > 0) {
        directCounterItems.push({
          id: `${s.id}:credit`,
          kind: 'prior_credit',
          title: 'crédito de pagamento anterior',
          createdAt: s.created_at,
          amountCents: credited,
          counterparties: [toParticipantRef(participantById, toId, s.to_name)],
        });
      }
    } else if (s.from_participant_id === toId && s.to_participant_id === fromId) {
      directCounterItems.push({
        id: `${s.id}:reverse`,
        kind: 'settlement_received',
        title: 'pagamento recebido',
        createdAt: s.created_at,
        amountCents: -amount,
        counterparties: [toParticipantRef(participantById, toId, s.from_name)],
      });
    } else if (s.from_participant_id === fromId && s.to_participant_id !== toId) {
      groupItems.push({
        id: `${s.id}:sent`,
        kind: 'settlement_sent',
        title: 'pagamento enviado',
        createdAt: s.created_at,
        amountCents: amount,
        counterparties: [toParticipantRef(participantById, s.to_participant_id, s.to_name)],
      });
    } else if (s.to_participant_id === fromId && s.from_participant_id !== toId) {
      groupItems.push({
        id: `${s.id}:received`,
        kind: 'settlement_received',
        title: 'pagamento recebido',
        createdAt: s.created_at,
        amountCents: -amount,
        payer: toParticipantRef(participantById, s.from_participant_id, s.from_name),
        counterparties: [],
      });
    }
  }

  let compensationDetails = null;
  if (mutualOffsetCents > 0) {
    const directCounterSubtotalCents = directCounterItems.reduce((sum, item) => sum + item.amountCents, 0);
    const groupSubtotalCents = groupItems.reduce((sum, item) => sum + item.amountCents, 0);
    const adjustmentCents = mutualOffsetCents - (directCounterSubtotalCents + groupSubtotalCents);

    compensationDetails = {
      directTotalBeforeCents: directOpenTotalBeforeCents,
      mutualOffsetCents,
      debtBeforeCents,
      fromTotalDebtCents,
      toTotalReceivableCents,
      directCounterItems,
      directCounterSubtotalCents,
      groupItems,
      groupSubtotalCents,
      adjustmentCents,
    };
  }

  let groupDebtDetails = null;
  if (groupDebtBeforeCents > 0) {
    // Flip sign to express how third-party and counter entries contribute to debt (+ adds debt, - reduces debt)
    const debtItems = [
      ...groupItems.map(item => ({
        ...item,
        amountCents: -item.amountCents,
      })),
      ...directCounterItems.map(item => ({
        ...item,
        amountCents: -item.amountCents,
      })),
    ];
    const itemsSubtotalCents = debtItems.reduce((sum, item) => sum + item.amountCents, 0);
    const allocatedElsewhereCents = Math.max(0, itemsSubtotalCents - groupDebtBeforeCents);
    const adjustmentCents = groupDebtBeforeCents - (itemsSubtotalCents - allocatedElsewhereCents);
    const otherCreditorsDebtCents = Math.max(0, fromTotalDebtCents - debtBeforeCents);

    groupDebtDetails = {
      groupDebtBeforeCents,
      fromTotalDebtCents,
      toTotalReceivableCents,
      directOpenTotalBeforeCents,
      otherCreditorsDebtCents,
      items: debtItems,
      itemsSubtotalCents,
      allocatedElsewhereCents,
      adjustmentCents,
    };
  }

  return { compensationDetails, groupDebtDetails };
}

/**
 * Computes a deterministic chronological receipt model for a single settlement payment.
 *
 * Rules:
 * - Only expenses and settlements up to the target settlement's timestamp (using the
 *   same deterministic tie-breaker as `computeSettlementBreakdowns`) are considered.
 * - Direct items are expenses paid by `to_participant_id` where `from_participant_id`
 *   had a nonzero share (`participantShareCents > 0`), ordered oldest-to-newest.
 * - Prior settlements from the same payer to the same receiver consume open direct shares
 *   strictly FIFO (oldest first, partial on the oldest open item if insufficient).
 * - Before applying the target settlement, any gap between total open direct items and
 *   the simplified pair debt (`debtBeforeCents`) is reconciled either as mutual/group
 *   compensation (reducing direct items FIFO) or as redirected group debt (`groupDebtBeforeCents`),
 *   each accompanied by exact itemized breakdown details for expandable receipt inspection.
 */
export function computeSettlementAttribution({
  settlementId,
  participants = [],
  expenses = [],
  settlements = [],
} = {}) {
  if (!settlementId) return null;
  const targetSettlement = settlements.find(s => s.id === settlementId);
  if (!targetSettlement) return null;

  const fromId = targetSettlement.from_participant_id;
  const toId = targetSettlement.to_participant_id;

  const breakdowns = computeSettlementBreakdowns({ participants, expenses, settlements });
  const breakdown = breakdowns.get(settlementId) || {
    amountCents: Math.round(targetSettlement.amount || 0),
    debtBeforeCents: 0,
    settledCents: 0,
    creditedCents: Math.round(targetSettlement.amount || 0),
    remainingCents: 0,
  };

  const timeline = [
    ...expenses.map(expense => ({ kind: 'expense', created_at: expense.created_at, id: expense.id, data: expense })),
    ...settlements.map(settlement => ({ kind: 'settlement', created_at: settlement.created_at, id: settlement.id, data: settlement })),
  ].sort(compareTimelineEntries);

  const directItems = [];
  const priorEntries = [];

  for (const entry of timeline) {
    if (entry.kind === 'expense') {
      priorEntries.push(entry);
      const expense = entry.data;
      if (expense.payer_id !== toId) continue;
      const shareCents = getParticipantExpenseShare(participants, expense, fromId);
      if (shareCents <= 0) continue;

      directItems.push({
        expenseId: expense.id,
        description: expense.description,
        createdAt: expense.created_at,
        splitMode: expense.split_mode,
        participantShareCents: shareCents,
        settledPriorCents: 0,
      });
      continue;
    }

    const s = entry.data;
    if (s.id === settlementId) break;

    if (s.from_participant_id !== fromId || s.to_participant_id !== toId) {
      priorEntries.push(entry);
      continue;
    }

    const sBreakdown = breakdowns.get(s.id);
    const sSettled = sBreakdown ? sBreakdown.settledCents : 0;
    if (sSettled <= 0) {
      priorEntries.push(entry);
      continue;
    }

    const priorDirectOpen = directItems.reduce(
      (sum, item) => sum + (item.participantShareCents - item.settledPriorCents),
      0,
    );
    const sDebtBefore = sBreakdown ? sBreakdown.debtBeforeCents : 0;
    const sOffset = Math.max(0, priorDirectOpen - sDebtBefore);

    const { allocated: offsetAllocated } = allocateFifo(
      sOffset,
      directItems,
      item => item.participantShareCents - item.settledPriorCents,
    );
    const { allocated: paidAllocated, leftoverCents: sGroupSettled } = allocateFifo(
      sSettled,
      directItems,
      (item, idx) => item.participantShareCents - item.settledPriorCents - offsetAllocated[idx],
    );

    for (let i = 0; i < directItems.length; i++) {
      directItems[i].settledPriorCents += paidAllocated[i];
    }

    priorEntries.push({ ...entry, groupSettledCents: sGroupSettled });
  }

  const directOpenTotalBeforeCents = directItems.reduce(
    (sum, item) => sum + (item.participantShareCents - item.settledPriorCents),
    0,
  );

  const mutualOffsetCents = Math.max(0, directOpenTotalBeforeCents - breakdown.debtBeforeCents);
  const groupDebtBeforeCents = Math.max(0, breakdown.debtBeforeCents - directOpenTotalBeforeCents);

  const { allocated: compensatedAllocated } = allocateFifo(
    mutualOffsetCents,
    directItems,
    item => item.participantShareCents - item.settledPriorCents,
  );

  const { allocated: settledNowAllocated, leftoverCents: afterDirectCents } = allocateFifo(
    breakdown.settledCents,
    directItems,
    (item, idx) => item.participantShareCents - item.settledPriorCents - compensatedAllocated[idx],
  );

  const groupSettledNowCents = Math.min(groupDebtBeforeCents, afterDirectCents);
  const groupRemainingAfterCents = Math.max(0, groupDebtBeforeCents - groupSettledNowCents);

  const items = directItems.map((item, idx) => {
    const compensatedCents = compensatedAllocated[idx];
    const settledNowCents = settledNowAllocated[idx];
    const remainingAfterCents = Math.max(
      0,
      item.participantShareCents - item.settledPriorCents - compensatedCents - settledNowCents,
    );
    return {
      expenseId: item.expenseId,
      description: item.description,
      createdAt: item.createdAt,
      splitMode: item.splitMode,
      participantShareCents: item.participantShareCents,
      settledPriorCents: item.settledPriorCents,
      compensatedCents,
      settledNowCents,
      remainingAfterCents,
      status: resolveAttributionStatus({
        participantShareCents: item.participantShareCents,
        settledPriorCents: item.settledPriorCents,
        compensatedCents,
        settledNowCents,
        remainingAfterCents,
      }),
    };
  });

  const { compensationDetails, groupDebtDetails } = buildReconciliationDetails({
    participants,
    priorEntries,
    breakdowns,
    fromId,
    toId,
    directOpenTotalBeforeCents,
    debtBeforeCents: breakdown.debtBeforeCents,
    mutualOffsetCents,
    groupDebtBeforeCents,
  });

  return {
    settlementId,
    fromParticipantId: fromId,
    toParticipantId: toId,
    breakdown,
    items,
    directOpenTotalBeforeCents,
    mutualOffsetCents,
    groupDebtBeforeCents,
    groupSettledNowCents,
    groupRemainingAfterCents,
    compensationDetails,
    groupDebtDetails,
  };
}
