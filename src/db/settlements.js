import { randomUUID } from 'node:crypto';

const SETTLEMENT_SELECT = `
  SELECT
    s.*,
    p1.name as from_name,
    p1.color as from_color,
    p1.user_id as from_user_id,
    a1.version as from_avatar_version,
    p2.name as to_name,
    p2.color as to_color,
    p2.user_id as to_user_id,
    a2.version as to_avatar_version
  FROM settlements s
  JOIN participants p1 ON p1.id = s.from_participant_id
  LEFT JOIN user_avatars a1 ON a1.user_id = p1.user_id
  JOIN participants p2 ON p2.id = s.to_participant_id
  LEFT JOIN user_avatars a2 ON a2.user_id = p2.user_id
`;

function validateSettlementInput(db, eventId, { fromParticipantId, toParticipantId, amount }) {
  if (fromParticipantId === toParticipantId) {
    throw new Error('Pagador e recebedor não podem ser a mesma pessoa');
  }

  const cents = Math.round(Number(amount));
  if (!Number.isSafeInteger(amount) || cents <= 0 || cents > 100000000000) {
    throw new Error('Valor da transferência deve ser maior que zero');
  }

  const fromP = db.prepare('SELECT id, name FROM participants WHERE id = ? AND event_id = ?').get(fromParticipantId, eventId);
  const toP = db.prepare('SELECT id, name FROM participants WHERE id = ? AND event_id = ?').get(toParticipantId, eventId);

  if (!fromP || !toP) {
    throw new Error('Participantes da transferência não encontrados neste evento');
  }

  return { cents, fromP, toP };
}

export function createSettlement(db, {
  eventId,
  fromParticipantId,
  toParticipantId,
  amount, // in cents
  notes = '',
  createdBy = null,
}) {
  const { cents, fromP, toP } = validateSettlementInput(db, eventId, {
    fromParticipantId,
    toParticipantId,
    amount,
  });

  const id = `stl_${randomUUID()}`;
  const now = new Date().toISOString();
  const trimmedNotes = notes ? notes.trim() : '';

  db.prepare(`
    INSERT INTO settlements (id, event_id, from_participant_id, to_participant_id, amount, notes, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, eventId, fromParticipantId, toParticipantId, cents, trimmedNotes, now, createdBy);

  return {
    id,
    event_id: eventId,
    from_participant_id: fromParticipantId,
    from_name: fromP.name,
    to_participant_id: toParticipantId,
    to_name: toP.name,
    amount: cents,
    notes: trimmedNotes,
    created_at: now,
    created_by: createdBy,
  };
}

export function getSettlementsByEvent(db, eventId) {
  return db.prepare(`
    ${SETTLEMENT_SELECT}
    WHERE s.event_id = ?
    ORDER BY s.created_at DESC
  `).all(eventId);
}

export function getSettlementById(db, id) {
  return db.prepare(`
    ${SETTLEMENT_SELECT}
    WHERE s.id = ?
  `).get(id) || null;
}

export function updateSettlement(db, id, {
  fromParticipantId,
  toParticipantId,
  amount, // in cents
  notes = '',
}) {
  const existing = getSettlementById(db, id);
  if (!existing) throw new Error('Pagamento não encontrado');

  const { cents } = validateSettlementInput(db, existing.event_id, {
    fromParticipantId,
    toParticipantId,
    amount,
  });

  db.prepare(`
    UPDATE settlements
    SET from_participant_id = ?, to_participant_id = ?, amount = ?, notes = ?
    WHERE id = ?
  `).run(fromParticipantId, toParticipantId, cents, notes ? notes.trim() : '', id);

  return getSettlementById(db, id);
}

export function deleteSettlement(db, id) {
  return db.prepare('DELETE FROM settlements WHERE id = ?').run(id);
}
