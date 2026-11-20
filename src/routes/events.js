import { Router } from 'express';
import { requireAuth, requireEventMember } from '../middleware/auth.js';
import { getDb } from '../db/connection.js';
import { createEvent, getEventByCode, getEventById, listUserEvents, deleteEvent, updateEvent } from '../db/events.js';
import { getExpensesByEvent } from '../db/expenses.js';
import { getSettlementsByEvent } from '../db/settlements.js';
import { recordActivityLog } from '../db/telemetry.js';
import { calculateBalances } from '../domain/settlement.js';
import {
  addParticipant,
  getParticipantsByEvent,
  getParticipantByUserAndEvent,
  claimParticipant,
  leaveEvent,
  getParticipantRemovalPreview,
  removeParticipantAndRedistribute,
} from '../db/participants.js';
import { recordTimelineEvent } from '../db/eventTimeline.js';
import { eventStreamHub } from '../domain/eventStreamHub.js';

const router = Router();

function openSseStream(req, res, { eventId = null, userId }) {
  const subscription = eventStreamHub.subscribe({
    eventId,
    userId,
    write: (chunk) => {
      if (res.writableEnded || res.destroyed) {
        throw new Error('SSE stream closed');
      }
      res.write(chunk);
    },
    close: () => {
      if (!res.writableEnded) res.end();
    },
  });

  if (!subscription.ok) {
    res.setHeader('Retry-After', '5');
    return res.status(503).json({ error: 'Servidor temporariamente sobrecarregado para conexões ao vivo.' });
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, eventId })}\n\n`);

  const cleanup = () => subscription.unsubscribe();
  req.on('close', cleanup);
  res.on('close', cleanup);
  return undefined;
}

// List user's active events
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const participantsForEvent = db.prepare('SELECT p.id, p.name, p.color, p.user_id, a.version AS avatar_version FROM participants p LEFT JOIN user_avatars a ON a.user_id = p.user_id WHERE p.event_id = ? ORDER BY p.created_at, p.id');
  const events = listUserEvents(db, req.user.id).map(event => {
    const participants = participantsForEvent.all(event.id);
    const current = participants.find(participant => participant.user_id === req.user.id);
    const balance = current ? calculateBalances(participants, getExpensesByEvent(db, event.id), getSettlementsByEvent(db, event.id)).get(current.id)?.netBalance : null;
    return { ...event, participants, user_balance: balance ?? null };
  });
  res.json({ events });
});

// Create new event
router.post('/', requireAuth, (req, res) => {
  try {
    const { title, description } = req.body || {};
    if (!title) return res.status(400).json({ error: 'Título do evento é obrigatório' });

    const db = getDb();
    const event = createEvent(db, {
      title,
      description,
      createdBy: req.user.id,
      creatorName: req.user.name,
    });
    recordActivityLog(db, {
      eventType: 'event_created',
      userId: req.user.id,
      eventId: event.id,
    });

    res.status(201).json({ event });
    eventStreamHub.publishToUsers([req.user.id], { eventId: event.id, reason: 'event_created' });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Erro ao criar evento' });
  }
});

// Live SSE stream for user's event list (EventsHome)
router.get('/stream', requireAuth, (req, res) => openSseStream(req, res, { eventId: null, userId: req.user.id }));

// Live SSE stream for a specific event (EventShell / ExpenseFeed)
router.get('/:id/stream', requireEventMember, (req, res) => openSseStream(req, res, { eventId: req.params.id, userId: req.user.id }));

// Get event by invite code (or ID)
router.get('/:code', (req, res) => {
  const { code } = req.params;
  const db = getDb();

  let event = getEventByCode(db, code);
  if (!event) {
    event = getEventById(db, code);
  }

  if (!event) {
    return res.status(404).json({ error: 'Evento não encontrado' });
  }

  const participants = getParticipantsByEvent(db, event.id);

  // Check if current logged-in user is already a participant
  const currentParticipant = req.user
    ? participants.find(p => p.user_id === req.user.id) || null
    : null;

  // Unclaimed participants (placeholders without user_id)
  const unclaimedParticipants = participants.filter(p => !p.user_id);

  res.json({
    event,
    participants,
    currentParticipant,
    unclaimedParticipants,
  });
});

// Add a placeholder participant to the event (admin only)
router.post('/:id/participants', requireEventMember, (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body || {};

    const db = getDb();
    const event = getEventById(db, id);
    if (!event) return res.status(404).json({ error: 'Evento não encontrado' });
    if (event.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Somente o admin pode adicionar participantes' });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Nome do participante é obrigatório' });
    }

    const participant = addParticipant(db, {
      eventId: event.id,
      name,
      joinSource: 'placeholder',
    });
    recordActivityLog(db, {
      eventType: 'participant_added',
      userId: req.user.id,
      eventId: event.id,
    });

    res.status(201).json({ participant });
    eventStreamHub.notifyEventChanged(db, event.id, { reason: 'participant_added' });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Erro ao adicionar participante' });
  }
});

// Preview financial impact of removing a participant (admin only)
router.get('/:id/participants/:participantId/removal-preview', requireAuth, (req, res) => {
  try {
    const { id, participantId } = req.params;
    const db = getDb();
    const event = getEventById(db, id);
    if (!event) return res.status(404).json({ error: 'Evento não encontrado' });
    if (event.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Somente o admin pode remover participantes' });
    }

    const preview = getParticipantRemovalPreview(db, { eventId: id, participantId });
    res.json({ preview });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Erro ao analisar remoção' });
  }
});

// Remove a participant (generic or user) and redistribute expenses (admin only)
router.delete('/:id/participants/:participantId', requireAuth, (req, res) => {
  try {
    const { id, participantId } = req.params;
    const { replacementPayerId = null } = req.body || {};
    const db = getDb();
    const event = getEventById(db, id);
    if (!event) return res.status(404).json({ error: 'Evento não encontrado' });
    if (event.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Somente o admin pode remover participantes' });
    }

    const result = removeParticipantAndRedistribute(db, {
      eventId: id,
      participantId,
      replacementPayerId,
    });
    recordActivityLog(db, {
      eventType: 'participant_removed',
      userId: req.user.id,
      eventId: id,
      metadata: {
        removed_participant_id: participantId,
        redistributed_expenses: result.preview.redistributedExpensesCount,
        reversed_settlements: result.preview.settlementsCount,
      },
    });

    res.json({ ok: true, ...result });
    eventStreamHub.notifyEventChanged(db, id, { reason: 'participant_removed' });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Erro ao remover participante' });
  }
});

// Claim an unclaimed participant slot
router.post('/:id/claim', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { participantId } = req.body || {};
    if (!participantId) {
      return res.status(400).json({ error: 'ID do participante a reivindicar é obrigatório' });
    }

    const db = getDb();
    const event = getEventById(db, id);
    if (!event) return res.status(404).json({ error: 'Evento não encontrado' });

    const target = db.prepare('SELECT id, event_id, name, color FROM participants WHERE id = ?').get(participantId);
    if (!target || target.event_id !== event.id) return res.status(400).json({ error: 'Participante inválido para este evento' });
    const participant = claimParticipant(db, {
      participantId,
      userId: req.user.id,
      userName: req.user.name,
    });
    recordTimelineEvent(db, {
      eventId: event.id,
      type: 'PARTICIPANT_CLAIMED',
      actorUserId: req.user.id,
      actorName: req.user.name,
      participantId: participant.id,
      placeholderName: target.name,
      placeholderColor: target.color,
    });
    recordActivityLog(db, {
      eventType: 'participant_claimed',
      userId: req.user.id,
      eventId: event.id,
    });

    res.json({ participant });
    eventStreamHub.notifyEventChanged(db, event.id, { reason: 'participant_claimed' });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Erro ao reivindicar participante' });
  }
});

// Join event as a brand-new participant
router.post('/:id/join', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();
    const event = getEventById(db, id);
    if (!event) return res.status(404).json({ error: 'Evento não encontrado' });

    const existing = getParticipantByUserAndEvent(db, event.id, req.user.id);
    if (existing) {
      return res.json({ participant: existing });
    }

    const participant = addParticipant(db, {
      eventId: event.id,
      userId: req.user.id,
      name: req.user.name,
      joinSource: 'join',
    });
    recordTimelineEvent(db, {
      eventId: event.id,
      type: 'PARTICIPANT_JOINED',
      actorUserId: req.user.id,
      actorName: req.user.name,
      participantId: participant.id,
      placeholderColor: participant.color,
    });
    recordActivityLog(db, {
      eventType: 'participant_joined',
      userId: req.user.id,
      eventId: event.id,
    });

    res.status(201).json({ participant });
    eventStreamHub.notifyEventChanged(db, event.id, { reason: 'participant_joined' });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Erro ao ingressar no evento' });
  }
});

// Leave event (guests only; detaches user_id leaving a generic participant behind)
router.post('/:id/leave', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();
    const event = getEventById(db, id);
    if (!event) return res.status(404).json({ error: 'Evento não encontrado' });
    if (event.created_by && event.created_by === req.user.id) {
      return res.status(403).json({ error: 'Quem criou o evento não pode sair sem excluí-lo' });
    }

    const result = leaveEvent(db, { eventId: id, userId: req.user.id });
    recordActivityLog(db, {
      eventType: 'participant_left',
      userId: req.user.id,
      eventId: id,
    });

    res.json({ ok: true, participant: result.participant, timelineEntry: result.timelineEntry });
    eventStreamHub.notifyEventChanged(db, id, { reason: 'participant_left' });
    eventStreamHub.publishToUsers([req.user.id], { eventId: id, reason: 'participant_left' });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Erro ao sair do evento' });
  }
});

router.put('/:id', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const event = getEventById(db, req.params.id);
    if (!event) return res.status(404).json({ error: 'Evento não encontrado' });
    if (event.created_by !== req.user.id) return res.status(403).json({ error: 'Somente quem criou o evento pode editá-lo' });
    const updated = updateEvent(db, req.params.id, req.body || {});
    recordActivityLog(db, {
      eventType: 'event_updated',
      userId: req.user.id,
      eventId: event.id,
    });
    res.json({ event: updated });
    eventStreamHub.notifyEventChanged(db, event.id, { reason: 'event_updated' });
  }
  catch (err) { res.status(400).json({ error: err.message || 'Erro ao atualizar evento' }); }
});

// Delete event
router.delete('/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();
    const event = getEventById(db, id);
    if (!event) return res.status(404).json({ error: 'Evento não encontrado' });

    if (event.created_by !== req.user.id) return res.status(403).json({ error: 'Somente quem criou o evento pode excluí-lo' });
    const memberRows = db.prepare(`
      SELECT DISTINCT user_id FROM participants WHERE event_id = ? AND user_id IS NOT NULL
      UNION
      SELECT created_by AS user_id FROM events WHERE id = ? AND created_by IS NOT NULL
    `).all(id, id);
    const memberUserIds = memberRows.map((row) => row.user_id).filter(Boolean);
    const stats = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM participants WHERE event_id = ?) AS participant_count,
        (SELECT COUNT(*) FROM expenses WHERE event_id = ?) AS expense_count
    `).get(id, id);
    deleteEvent(db, id);
    recordActivityLog(db, {
      eventType: 'event_deleted',
      userId: req.user.id,
      eventId: id,
      metadata: {
        title: event.title,
        participant_count: Number(stats?.participant_count || 0),
        expense_count: Number(stats?.expense_count || 0),
      },
    });
    res.json({ ok: true });
    eventStreamHub.publishEvent(id, { reason: 'event_deleted' });
    eventStreamHub.publishToUsers(memberUserIds, { eventId: id, reason: 'event_deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Erro ao excluir evento' });
  }
});

export default router;
