import { Router } from 'express';
import { requireAuth, requireEventMember, isEventMember } from '../middleware/auth.js';
import { getDb } from '../db/connection.js';
import { getEventById } from '../db/events.js';
import { getParticipantsByEvent } from '../db/participants.js';
import { getExpensesByEvent } from '../db/expenses.js';
import { createSettlement, getSettlementsByEvent, updateSettlement, deleteSettlement } from '../db/settlements.js';
import { recordActivityLog } from '../db/telemetry.js';
import { eventStreamHub } from '../domain/eventStreamHub.js';
import { calculateBalances, simplifyDebts, getParticipantSummary } from '../domain/settlement.js';

const router = Router();

// Get balances, net status and simplified debt graph for an event
router.get('/events/:id/balances', requireEventMember, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const event = getEventById(db, id);
  if (!event) return res.status(404).json({ error: 'Evento não encontrado' });

  const participants = getParticipantsByEvent(db, id);
  const expenses = getExpensesByEvent(db, id);
  const settlements = getSettlementsByEvent(db, id);

  const statsMap = calculateBalances(participants, expenses, settlements);
  const simplifiedTransactions = simplifyDebts(statsMap);

  // Array of all participants stats
  const balances = Array.from(statsMap.values());

  // Current user's participant summary
  let userSummary = null;
  if (req.user) {
    const userParticipant = participants.find(p => p.user_id === req.user.id);
    if (userParticipant) {
      userSummary = getParticipantSummary(userParticipant.id, statsMap, simplifiedTransactions);
    }
  }

  // Total spent in this event
  const totalSpent = expenses.reduce((sum, e) => sum + e.amount, 0);

  res.json({
    totalSpent,
    balances,
    simplifiedTransactions,
    settlements,
    userSummary,
  });
});

// Record a settlement payment
router.post('/events/:id/settlements', requireEventMember, (req, res) => {
  try {
    const { id } = req.params;
    const { fromParticipantId, toParticipantId, amount, notes } = req.body || {};

    const db = getDb();
    const event = getEventById(db, id);
    if (!event) return res.status(404).json({ error: 'Evento não encontrado' });

    const settlement = createSettlement(db, {
      eventId: id,
      fromParticipantId,
      toParticipantId,
      amount,
      notes,
      createdBy: req.user?.id || null,
    });
    recordActivityLog(db, {
      eventType: 'settlement_created',
      userId: req.user?.id || null,
      eventId: id,
      metadata: { amount: settlement.amount },
    });

    res.status(201).json({ settlement });
    eventStreamHub.notifyEventChanged(db, id, { reason: 'settlement_created', settlementId: settlement.id });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Erro ao registrar pagamento' });
  }
});

// Update a settlement payment
router.put('/settlements/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { fromParticipantId, toParticipantId, amount, notes } = req.body || {};
    const db = getDb();
    const existing = db.prepare('SELECT event_id FROM settlements WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Pagamento não encontrado' });
    if (!isEventMember(db, existing.event_id, req.user.id)) return res.status(403).json({ error: 'Acesso restrito aos participantes do evento' });

    const settlement = updateSettlement(db, id, {
      fromParticipantId,
      toParticipantId,
      amount,
      notes,
    });
    recordActivityLog(db, {
      eventType: 'settlement_updated',
      userId: req.user.id,
      eventId: existing.event_id,
      metadata: { amount: settlement.amount },
    });

    res.json({ settlement });
    eventStreamHub.notifyEventChanged(db, existing.event_id, { reason: 'settlement_updated', settlementId: id });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Erro ao atualizar pagamento' });
  }
});

// Delete a settlement payment
router.delete('/settlements/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();
    const settlement = db.prepare('SELECT event_id, amount FROM settlements WHERE id = ?').get(id);
    if (!settlement) return res.status(404).json({ error: 'Pagamento não encontrado' });
    if (!isEventMember(db, settlement.event_id, req.user.id)) return res.status(403).json({ error: 'Acesso restrito aos participantes do evento' });
    deleteSettlement(db, id);
    recordActivityLog(db, {
      eventType: 'settlement_deleted',
      userId: req.user.id,
      eventId: settlement.event_id,
      metadata: { amount: settlement.amount },
    });
    res.json({ ok: true });
    eventStreamHub.notifyEventChanged(db, settlement.event_id, { reason: 'settlement_deleted', settlementId: id });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Erro ao excluir liquidação' });
  }
});

export default router;
