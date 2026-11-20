import { randomUUID } from 'node:crypto';

const ALLOWED_TIMELINE_TYPES = new Set([
  'PARTICIPANT_JOINED',
  'PARTICIPANT_CLAIMED',
  'PARTICIPANT_LEFT',
]);

/**
 * Persists a member lifecycle event (join, claim, or leave) for chronological feed display.
 */
export function recordTimelineEvent(db, {
  eventId,
  type,
  actorUserId = null,
  actorName,
  participantId = null,
  placeholderName = null,
  placeholderColor = null,
  createdAt = new Date().toISOString(),
}) {
  if (!ALLOWED_TIMELINE_TYPES.has(type)) {
    throw new Error('Tipo de evento de linha do tempo inválido');
  }
  const id = `tl_${randomUUID()}`;
  const safeActorName = typeof actorName === 'string' && actorName.trim() ? actorName.trim() : 'Participante';

  db.prepare(`
    INSERT INTO event_timeline_events (
      id, event_id, type, actor_user_id, actor_name,
      participant_id, placeholder_name, placeholder_color, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    eventId,
    type,
    actorUserId,
    safeActorName,
    participantId,
    placeholderName ? placeholderName.trim() : null,
    placeholderColor || null,
    createdAt,
  );

  return {
    id,
    event_id: eventId,
    type,
    actor_user_id: actorUserId,
    actor_name: safeActorName,
    participant_id: participantId,
    placeholder_name: placeholderName ? placeholderName.trim() : null,
    placeholder_color: placeholderColor || null,
    created_at: createdAt,
  };
}

/**
 * Fetches timeline events for an event joined with current user avatar version and name.
 */
export function getEventTimeline(db, eventId) {
  return db.prepare(`
    SELECT
      t.*,
      COALESCE(u.name, t.actor_name) AS current_actor_name,
      ua.version AS actor_avatar_version,
      p.name AS current_participant_name,
      p.color AS current_participant_color,
      p.user_id AS current_participant_user_id
    FROM event_timeline_events t
    LEFT JOIN users u ON u.id = t.actor_user_id
    LEFT JOIN user_avatars ua ON ua.user_id = t.actor_user_id
    LEFT JOIN participants p ON p.id = t.participant_id
    WHERE t.event_id = ?
    ORDER BY t.created_at DESC, t.id DESC
  `).all(eventId);
}
