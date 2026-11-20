import { randomBytes, randomUUID } from 'node:crypto';
import { addParticipant } from './participants.js';

function generateInviteCode() {
  // 128-bit invitation capability; existing links remain valid.
  return randomBytes(16).toString('hex');
}

export function createEvent(db, { title, description = '', createdBy = null, creatorName = 'Organizador' }) {
  if (typeof title !== 'string' || title.length > 200 || typeof description !== 'string' || description.length > 2000) throw new Error('Título ou descrição inválidos');
  const trimmedTitle = title.trim();
  if (!trimmedTitle) throw new Error('Título do evento é obrigatório');

  const id = `ev_${randomUUID()}`;
  let code = generateInviteCode();

  // Ensure code uniqueness
  while (db.prepare('SELECT id FROM events WHERE code = ?').get(code)) {
    code = generateInviteCode();
  }

  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO events (id, code, title, description, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, code, trimmedTitle, description ? description.trim() : '', createdBy, now);

  // Automatically add the creator as the first participant
  const creatorParticipant = addParticipant(db, {
    eventId: id,
    userId: createdBy,
    name: creatorName,
    joinSource: 'creator',
  });

  return {
    id,
    code,
    title: trimmedTitle,
    description: description ? description.trim() : '',
    created_by: createdBy,
    created_at: now,
    creatorParticipant,
  };
}

export function getEventByCode(db, code) {
  if (!code) return null;
  return db.prepare('SELECT * FROM events WHERE code = ? COLLATE NOCASE').get(code.trim());
}

export function getEventById(db, id) {
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id);
}

export function listUserEvents(db, userId) {
  if (!userId) return [];
  return db.prepare(`
    SELECT e.*,
      COALESCE(a.updated_at, e.created_at) AS updated_at,
      (SELECT count(*) FROM participants WHERE event_id = e.id) AS participant_count,
      (SELECT count(*) FROM expenses WHERE event_id = e.id) AS expense_count,
      (SELECT COALESCE(sum(amount), 0) FROM expenses WHERE event_id = e.id) AS total_expenses,
      (SELECT description FROM expenses WHERE event_id = e.id ORDER BY created_at DESC, id DESC LIMIT 1) AS latest_expense_description,
      (SELECT amount FROM expenses WHERE event_id = e.id ORDER BY created_at DESC, id DESC LIMIT 1) AS latest_expense_amount
    FROM events e LEFT JOIN event_activity a ON a.event_id = e.id
    WHERE e.created_by = ? OR EXISTS (SELECT 1 FROM participants p WHERE p.event_id = e.id AND p.user_id = ?)
    ORDER BY updated_at DESC, e.created_at DESC, e.id DESC
  `).all(userId, userId);
}

export function deleteEvent(db, id) {
  return db.prepare('DELETE FROM events WHERE id = ?').run(id);
}

export function updateEvent(db, id, { title, description }) {
  if (typeof title !== 'string' || !title.trim() || title.length > 200 || typeof description !== 'string' || description.length > 2000) throw new Error('Título ou descrição inválidos');
  db.prepare('UPDATE events SET title = ?, description = ? WHERE id = ?').run(title.trim(), description.trim(), id);
  db.prepare("INSERT INTO event_activity (event_id, updated_at) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT(event_id) DO UPDATE SET updated_at = excluded.updated_at").run(id);
  return getEventById(db, id);
}
