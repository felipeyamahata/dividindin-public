/**
 * Pure builders for merging expenses, settlement payments, and member lifecycle timeline pills
 * into a single chronological feed grouped by calendar date.
 */

function toTimestampMs(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

const KIND_PRIORITY = {
  timeline: 3,
  settlement: 2,
  expense: 1,
};

/**
 * Merges expenses, settlements, and timeline events sorted newest-first.
 */
export function buildUnifiedFeed({ expenses = [], settlements = [], timelineEvents = [] } = {}) {
  const items = [];

  for (const expense of expenses) {
    items.push({
      kind: 'expense',
      id: expense.id,
      created_at: expense.created_at,
      senderParticipantId: expense.payer_id || null,
      data: expense,
    });
  }

  for (const settlement of settlements) {
    items.push({
      kind: 'settlement',
      id: settlement.id,
      created_at: settlement.created_at,
      senderParticipantId: settlement.from_participant_id || null,
      data: settlement,
    });
  }

  for (const entry of timelineEvents) {
    items.push({
      kind: 'timeline',
      id: entry.id,
      created_at: entry.created_at,
      senderParticipantId: null,
      data: entry,
    });
  }

  items.sort((a, b) => {
    const diff = toTimestampMs(b.created_at) - toTimestampMs(a.created_at);
    if (diff !== 0) return diff;
    const pDiff = (KIND_PRIORITY[b.kind] || 0) - (KIND_PRIORITY[a.kind] || 0);
    if (pDiff !== 0) return pDiff;
    return String(b.id).localeCompare(String(a.id));
  });

  return items;
}
