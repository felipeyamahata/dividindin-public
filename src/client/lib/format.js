export function formatCurrency(cents = 0) {
  const value = (cents || 0) / 100;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

export function formatShortCurrency(cents = 0) {
  const value = (cents || 0) / 100;
  return `R$ ${value.toFixed(2).replace('.', ',')}`;
}

/**
 * Formats net paid summary label and absolute amount in centavos,
 * flipping to "recebeu" when net cash flow is negative (received > paid + sent).
 */
export function getPaidSummaryDisplay(stats, { own = false } = {}) {
  if (!stats) return null;
  const netPaid = Number.isFinite(stats.netPaid)
    ? stats.netPaid
    : (stats.totalPaid || 0) + (stats.paymentsSent || 0) - (stats.paymentsReceived || 0);
  const isNegativeNetPaid = netPaid < 0;
  return {
    label: isNegativeNetPaid
      ? (own ? 'você recebeu' : 'recebeu')
      : (own ? 'você pagou' : 'pagou'),
    amountCents: Math.abs(netPaid),
    isNegativeNetPaid,
  };
}

export function getInitials(name = '') {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export function formatTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Formats an ISO timestamp into a compact pt-BR receipt header label (`13 nov 2026 · 15:18`).
 */
export function formatReceiptDateTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  const day = date.getDate();
  const month = date.toLocaleDateString('pt-BR', { month: 'short' }).replace(/\.$/, '');
  const year = date.getFullYear();
  return `${day} ${month} ${year} · ${formatTime(isoString)}`;
}

export function formatExpenseDateGroup(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  const now = new Date();
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((t - d) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'hoje';
  if (diffDays === 1) return 'ontem';
  const day = date.getDate();
  const month = date.toLocaleDateString('pt-BR', { month: 'short' });
  const year = date.getFullYear();
  return `${day} de ${month} ${year}`;
}

export function getDateKey(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function groupExpensesByDate(expenses = []) {
  const groups = [];
  let currentGroup = null;

  for (let i = 0; i < expenses.length; i++) {
    const expense = expenses[i];
    const dateKey = getDateKey(expense.created_at) || 'unknown';

    if (!currentGroup || currentGroup.dateKey !== dateKey) {
      currentGroup = {
        dateKey,
        label: formatExpenseDateGroup(expense.created_at),
        items: [],
      };
      groups.push(currentGroup);
    }

    const prevItem = currentGroup.items[currentGroup.items.length - 1];
    const isSamePayerAsPrev = Boolean(prevItem && prevItem.expense.payer_id === expense.payer_id);

    currentGroup.items.push({
      expense,
      isFirstInSequence: !isSamePayerAsPrev,
    });
  }

  return groups;
}

export function groupFeedByDate(entries = []) {
  const groups = [];
  let currentGroup = null;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const dateKey = getDateKey(entry.created_at) || 'unknown';

    if (!currentGroup || currentGroup.dateKey !== dateKey) {
      currentGroup = {
        dateKey,
        label: formatExpenseDateGroup(entry.created_at),
        items: [],
      };
      groups.push(currentGroup);
    }

    const prevItem = currentGroup.items[currentGroup.items.length - 1];
    const isSameSenderAsPrev = Boolean(
      entry.kind !== 'timeline'
      && prevItem
      && prevItem.entry.kind !== 'timeline'
      && prevItem.entry.senderParticipantId
      && prevItem.entry.senderParticipantId === entry.senderParticipantId,
    );

    currentGroup.items.push({
      entry,
      isFirstInSequence: !isSameSenderAsPrev,
    });
  }

  return groups;
}
