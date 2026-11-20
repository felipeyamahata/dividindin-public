import { randomUUID } from 'node:crypto';

function validateExpense(db, eventId, { description, amount, payerId, splitMode = 'EQUAL_ALL', splits = [] }) {
  if (typeof description !== 'string' || !description.trim() || description.length > 200) throw new Error('Descrição inválida');
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100000000000) throw new Error('Valor do gasto inválido');
  if (!db.prepare('SELECT 1 FROM participants WHERE id = ? AND event_id = ?').get(payerId, eventId)) throw new Error('Pagador inválido para este evento');
  if (!['EQUAL_ALL', 'SUBSET_EQUAL', 'EXACT_AMOUNTS', 'PERCENTAGES', 'SHARES'].includes(splitMode)) throw new Error('Tipo de divisão inválido');
  if (!Array.isArray(splits) || splits.length > 200) throw new Error('Divisão inválida');
  if (splitMode === 'EQUAL_ALL') {
    if (splits.length) throw new Error('Divisão igual não aceita parcelas');
    return;
  }
  if (!splits.length) throw new Error('Selecione participantes');
  const ids = new Set();
  for (const split of splits) {
    if (!split || ids.has(split.participant_id) || !db.prepare('SELECT 1 FROM participants WHERE id = ? AND event_id = ?').get(split.participant_id, eventId)) throw new Error('Participante inválido ou duplicado');
    ids.add(split.participant_id);
    if (splitMode === 'EXACT_AMOUNTS' && (!Number.isSafeInteger(split.allocated_amount) || split.allocated_amount <= 0)) throw new Error('Valor individual inválido');
    if (splitMode === 'PERCENTAGES' && (!Number.isFinite(split.percentage) || split.percentage <= 0 || split.percentage > 100)) throw new Error('Percentual inválido');
    if (splitMode === 'SHARES' && (!Number.isSafeInteger(split.shares) || split.shares <= 0 || split.shares > 1000000)) throw new Error('Número de partes inválido');
  }
  if (splitMode === 'EXACT_AMOUNTS' && splits.reduce((sum, x) => sum + x.allocated_amount, 0) !== amount) throw new Error('A soma das parcelas deve ser igual ao gasto');
  if (splitMode === 'PERCENTAGES' && Math.abs(splits.reduce((sum, x) => sum + x.percentage, 0) - 100) > 0.000001) throw new Error('A soma dos percentuais deve ser 100%');
}

function transaction(db, callback) {
  db.exec('SAVEPOINT expense_write');
  try { const result = callback(); db.exec('RELEASE expense_write'); return result; }
  catch (error) { db.exec('ROLLBACK TO expense_write'); db.exec('RELEASE expense_write'); throw error; }
}

export function createExpense(db, {
  eventId,
  description,
  amount, // in cents
  payerId,
  splitMode = 'EQUAL_ALL',
  splits = [],
  createdBy = null,
}) {
  validateExpense(db, eventId, { description, amount, payerId, splitMode, splits });
  return transaction(db, () => {
  const trimmedDesc = description.trim();
  if (!trimmedDesc) throw new Error('Descrição do gasto é obrigatória');

  const cents = Math.round(Number(amount));
  if (cents <= 0) throw new Error('O valor do gasto deve ser maior que zero');

  const payer = db.prepare('SELECT id, name FROM participants WHERE id = ? AND event_id = ?').get(payerId, eventId);
  if (!payer) throw new Error('Pagador inválido para este evento');

  const id = `exp_${randomUUID()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO expenses (id, event_id, description, amount, payer_id, split_mode, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, eventId, trimmedDesc, cents, payerId, splitMode, createdBy, now);

  // If not EQUAL_ALL, record specific split targets
  if (splitMode !== 'EQUAL_ALL' && Array.isArray(splits)) {
    const insertSplit = db.prepare(`
      INSERT INTO expense_splits (id, expense_id, participant_id, allocated_amount, percentage, shares)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const s of splits) {
      const splitId = `sp_${randomUUID()}`;
      insertSplit.run(
        splitId,
        id,
        s.participant_id,
        s.allocated_amount ? Math.round(s.allocated_amount) : null,
        s.percentage !== undefined && s.percentage !== null ? Number(s.percentage) : null,
        s.shares !== undefined && s.shares !== null ? Number(s.shares) : null
      );
    }
  }

  return getExpenseById(db, id);
  });
}

export function updateExpense(db, id, {
  description,
  amount,
  payerId,
  splitMode = 'EQUAL_ALL',
  splits = [],
}) {
  const existing = getExpenseById(db, id);
  if (!existing) throw new Error('Gasto não encontrado');

  validateExpense(db, existing.event_id, { description, amount, payerId, splitMode, splits });
  return transaction(db, () => {
  const trimmedDesc = description.trim();
  if (!trimmedDesc) throw new Error('Descrição do gasto é obrigatória');

  const cents = Math.round(Number(amount));
  if (cents <= 0) throw new Error('O valor do gasto deve ser maior que zero');

  const payer = db.prepare('SELECT id, name FROM participants WHERE id = ? AND event_id = ?').get(payerId, existing.event_id);
  if (!payer) throw new Error('Pagador inválido para este evento');

  db.prepare(`
    UPDATE expenses
    SET description = ?, amount = ?, payer_id = ?, split_mode = ?
    WHERE id = ?
  `).run(trimmedDesc, cents, payerId, splitMode, id);

  // Re-create splits
  db.prepare('DELETE FROM expense_splits WHERE expense_id = ?').run(id);

  if (splitMode !== 'EQUAL_ALL' && Array.isArray(splits)) {
    const insertSplit = db.prepare(`
      INSERT INTO expense_splits (id, expense_id, participant_id, allocated_amount, percentage, shares)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const s of splits) {
      const splitId = `sp_${randomUUID()}`;
      insertSplit.run(
        splitId,
        id,
        s.participant_id,
        s.allocated_amount ? Math.round(s.allocated_amount) : null,
        s.percentage !== undefined && s.percentage !== null ? Number(s.percentage) : null,
        s.shares !== undefined && s.shares !== null ? Number(s.shares) : null
      );
    }
  }

  return getExpenseById(db, id);
  });
}

export function getExpenseById(db, id) {
  const expense = db.prepare(`
    SELECT e.*, p.name as payer_name, p.color as payer_color
    FROM expenses e
    JOIN participants p ON p.id = e.payer_id
    WHERE e.id = ?
  `).get(id);

  if (!expense) return null;

  const splits = db.prepare(`
    SELECT s.*, p.name as participant_name
    FROM expense_splits s
    JOIN participants p ON p.id = s.participant_id
    WHERE s.expense_id = ?
  `).all(id);

  return { ...expense, splits };
}

export function getExpensesByEvent(db, eventId) {
  const expenses = db.prepare(`
    SELECT e.*, p.name as payer_name, p.color as payer_color
    FROM expenses e
    JOIN participants p ON p.id = e.payer_id
    WHERE e.event_id = ?
    ORDER BY e.created_at DESC
  `).all(eventId);

  const allSplits = db.prepare(`
    SELECT s.*, p.name as participant_name
    FROM expense_splits s
    JOIN participants p ON p.id = s.participant_id
    JOIN expenses e ON e.id = s.expense_id
    WHERE e.event_id = ?
  `).all(eventId);

  const splitsByExpense = new Map();
  for (const s of allSplits) {
    if (!splitsByExpense.has(s.expense_id)) splitsByExpense.set(s.expense_id, []);
    splitsByExpense.get(s.expense_id).push(s);
  }

  return expenses.map(exp => ({
    ...exp,
    splits: splitsByExpense.get(exp.id) || [],
  }));
}

export function deleteExpense(db, id) {
  return db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
}
