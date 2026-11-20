import { randomUUID } from 'node:crypto';
import { getExpensesByEvent } from './expenses.js';
import { recordTimelineEvent } from './eventTimeline.js';
import { redistributeExpenseAfterRemoval } from '../domain/expenseRedistribution.js';

export const PARTICIPANT_PALETTE = [
  '#6366F1', // Indigo
  '#EC4899', // Pink
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#8B5CF6', // Purple
  '#3B82F6', // Blue
  '#EF4444', // Red
  '#14B8A6', // Teal
  '#06B6D4', // Cyan
  '#F97316', // Orange
];

const ALLOWED_JOIN_SOURCES = new Set(['creator', 'placeholder', 'claim', 'join', 'left']);

function runSavepoint(db, name, callback) {
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = callback();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (error) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    throw error;
  }
}

export function addParticipant(db, { eventId, userId = null, name, color = null, joinSource = 'placeholder' }) {
  if (typeof name !== 'string' || name.length > 100) throw new Error('Nome inválido');
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error('Nome do participante é obrigatório');

  // Count existing to pick color sequentially
  const countRow = db.prepare('SELECT COUNT(*) as count FROM participants WHERE event_id = ?').get(eventId);
  const colorIndex = (countRow?.count || 0) % PARTICIPANT_PALETTE.length;
  const assignedColor = color || PARTICIPANT_PALETTE[colorIndex];
  const resolvedSource = ALLOWED_JOIN_SOURCES.has(joinSource) ? joinSource : 'placeholder';

  const id = `pt_${randomUUID()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO participants (id, event_id, user_id, name, color, created_at, join_source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, eventId, userId, trimmedName, assignedColor, now, resolvedSource);

  return { id, event_id: eventId, user_id: userId, name: trimmedName, color: assignedColor, created_at: now, join_source: resolvedSource };
}

export function getParticipantsByEvent(db, eventId) {
  return db.prepare(`
    SELECT p.id, p.event_id, p.user_id, p.name, p.color, p.created_at, p.join_source, a.version AS avatar_version
    FROM participants p
    LEFT JOIN user_avatars a ON a.user_id = p.user_id
    WHERE p.event_id = ?
    ORDER BY p.created_at ASC
  `).all(eventId);
}

export function getParticipantById(db, id) {
  return db.prepare('SELECT * FROM participants WHERE id = ?').get(id);
}

export function getParticipantByUserAndEvent(db, eventId, userId) {
  if (!userId) return null;
  return db.prepare('SELECT * FROM participants WHERE event_id = ? AND user_id = ?').get(eventId, userId);
}

/**
 * Claim an unclaimed participant slot.
 * Replaces the placeholder name with the authenticated user's real name
 * and ties the user's account to the participant slot.
 */
export function claimParticipant(db, { participantId, userId, userName }) {
  const participant = getParticipantById(db, participantId);
  if (!participant) {
    throw new Error('Participante não encontrado');
  }

  if (participant.user_id) {
    throw new Error('Este participante já foi vinculado a outro usuário');
  }

  // Check if current user is already in this event
  const existing = getParticipantByUserAndEvent(db, participant.event_id, userId);
  if (existing && existing.id !== participantId) {
    throw new Error('Você já participa deste evento como outro participante');
  }

  const finalName = userName ? userName.trim() : participant.name;

  db.prepare(`
    UPDATE participants
    SET user_id = ?, name = ?, join_source = 'claim'
    WHERE id = ?
  `).run(userId, finalName, participantId);

  return getParticipantById(db, participantId);
}

/**
 * Detaches an invited user from their event participant slot, leaving a generic participant
 * behind with all expenses, splits, and settlements preserved, and logs timeline history.
 */
export function leaveEvent(db, { eventId, userId }) {
  return runSavepoint(db, 'leave_event_write', () => {
    const event = db.prepare('SELECT id, created_by FROM events WHERE id = ?').get(eventId);
    if (!event) throw new Error('Evento não encontrado');
    if (event.created_by && event.created_by === userId) {
      throw new Error('Quem criou o evento não pode sair sem excluí-lo');
    }

    const participant = getParticipantByUserAndEvent(db, eventId, userId);
    if (!participant) {
      throw new Error('Você não participa deste evento');
    }

    const userRow = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
    const actorName = userRow?.name?.trim() || participant.name;

    db.prepare(`
      UPDATE participants
      SET user_id = NULL, join_source = 'left'
      WHERE id = ? AND event_id = ?
    `).run(participant.id, eventId);

    const timelineEntry = recordTimelineEvent(db, {
      eventId,
      type: 'PARTICIPANT_LEFT',
      actorUserId: userId,
      actorName,
      participantId: participant.id,
      placeholderName: participant.name,
      placeholderColor: participant.color,
    });

    return {
      participant: getParticipantById(db, participant.id),
      timelineEntry,
    };
  });
}

/**
 * Computes financial impact summary before removing a participant from an event.
 */
export function getParticipantRemovalPreview(db, { eventId, participantId }) {
  const event = db.prepare('SELECT id, created_by FROM events WHERE id = ?').get(eventId);
  if (!event) throw new Error('Evento não encontrado');

  const participant = db.prepare('SELECT * FROM participants WHERE id = ? AND event_id = ?').get(participantId, eventId);
  if (!participant) throw new Error('Participante não encontrado neste evento');

  if (participant.user_id && event.created_by && participant.user_id === event.created_by) {
    throw new Error('O admin do evento não pode ser removido');
  }

  const paidStats = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
    FROM expenses
    WHERE event_id = ? AND payer_id = ?
  `).get(eventId, participantId);

  const settlementStats = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
    FROM settlements
    WHERE event_id = ? AND (from_participant_id = ? OR to_participant_id = ?)
  `).get(eventId, participantId, participantId);

  const expenses = getExpensesByEvent(db, eventId);
  let redistributedExpensesCount = 0;
  let orphanExpensesCount = 0;
  let equalAllExpensesCount = 0;

  for (const expense of expenses) {
    if (expense.split_mode === 'EQUAL_ALL') {
      equalAllExpensesCount++;
      continue;
    }
    const plan = redistributeExpenseAfterRemoval({ expense, removedParticipantId: participantId });
    if (plan.action === 'update') redistributedExpensesCount++;
    else if (plan.action === 'delete_orphan') orphanExpensesCount++;
  }

  return {
    participant,
    paidExpensesCount: Number(paidStats?.count || 0),
    paidExpensesTotal: Number(paidStats?.total || 0),
    settlementsCount: Number(settlementStats?.count || 0),
    settlementsTotal: Number(settlementStats?.total || 0),
    redistributedExpensesCount,
    orphanExpensesCount,
    equalAllExpensesCount,
  };
}

/**
 * Removes a participant (generic or registered) from an event (Option 1):
 * 1. Reassigns any expenses paid by the removed participant to `replacementPayerId`.
 * 2. Reverses (deletes) settlements involving the removed participant.
 * 3. Redistributes consumed splits equally in cents across remaining expense participants.
 * 4. Deletes the participant row.
 */
export function removeParticipantAndRedistribute(db, { eventId, participantId, replacementPayerId = null }) {
  return runSavepoint(db, 'remove_participant_write', () => {
    const preview = getParticipantRemovalPreview(db, { eventId, participantId });

    if (preview.paidExpensesCount > 0) {
      if (!replacementPayerId || replacementPayerId === participantId) {
        throw new Error('Escolha quem assumirá as despesas pagas por este participante');
      }
      const replacement = db.prepare('SELECT id FROM participants WHERE id = ? AND event_id = ?').get(replacementPayerId, eventId);
      if (!replacement) {
        throw new Error('Pagador substituto inválido para este evento');
      }
      db.prepare('UPDATE expenses SET payer_id = ? WHERE event_id = ? AND payer_id = ?')
        .run(replacementPayerId, eventId, participantId);
    }

    if (preview.settlementsCount > 0) {
      db.prepare('DELETE FROM settlements WHERE event_id = ? AND (from_participant_id = ? OR to_participant_id = ?)')
        .run(eventId, participantId, participantId);
    }

    const expenses = getExpensesByEvent(db, eventId);
    const updateModeStmt = db.prepare('UPDATE expenses SET split_mode = ? WHERE id = ?');
    const deleteSplitsStmt = db.prepare('DELETE FROM expense_splits WHERE expense_id = ?');
    const deleteExpenseStmt = db.prepare('DELETE FROM expenses WHERE id = ?');
    const insertSplitStmt = db.prepare(`
      INSERT INTO expense_splits (id, expense_id, participant_id, allocated_amount, percentage, shares)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const expense of expenses) {
      const plan = redistributeExpenseAfterRemoval({ expense, removedParticipantId: participantId });
      if (plan.action === 'delete_orphan') {
        deleteExpenseStmt.run(expense.id);
      } else if (plan.action === 'update') {
        updateModeStmt.run(plan.nextSplitMode, expense.id);
        deleteSplitsStmt.run(expense.id);
        for (const split of plan.nextSplits) {
          insertSplitStmt.run(
            `sp_${randomUUID()}`,
            expense.id,
            split.participant_id,
            split.allocated_amount ?? null,
            split.percentage ?? null,
            split.shares ?? null,
          );
        }
      }
    }

    db.prepare('DELETE FROM participants WHERE id = ? AND event_id = ?').run(participantId, eventId);

    return {
      removedId: participantId,
      preview,
    };
  });
}
