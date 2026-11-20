import { Router } from 'express';
import { requireAuth, requireEventMember, isEventMember } from '../middleware/auth.js';
import { getDb } from '../db/connection.js';
import { getEventById } from '../db/events.js';
import { getEventTimeline } from '../db/eventTimeline.js';
import { recordActivityLog } from '../db/telemetry.js';
import { eventStreamHub } from '../domain/eventStreamHub.js';
import {
  createExpense,
  getExpensesByEvent,
  deleteExpense,
  getExpenseById,
  updateExpense,
} from '../db/expenses.js';

const router = Router();

// List expenses of an event
router.get('/events/:id/expenses', requireEventMember, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const event = getEventById(db, id);
  if (!event) return res.status(404).json({ error: 'Evento não encontrado' });

  const expenses = getExpensesByEvent(db, id);
  const timelineEvents = getEventTimeline(db, id);
  res.json({ expenses, timelineEvents });
});

// Create expense
router.post('/events/:id/expenses', requireEventMember, (req, res) => {
  try {
    const { id } = req.params;
    const { description, amount, payerId, splitMode, splits } = req.body || {};

    const db = getDb();
    const event = getEventById(db, id);
    if (!event) return res.status(404).json({ error: 'Evento não encontrado' });

    const expense = createExpense(db, {
      eventId: id,
      description,
      amount,
      payerId,
      splitMode: splitMode || 'EQUAL_ALL',
      splits: splits || [],
      createdBy: req.user?.id || null,
    });
    recordActivityLog(db, {
      eventType: 'expense_created',
      userId: req.user?.id || null,
      eventId: id,
      metadata: { amount: expense.amount, split_mode: expense.split_mode },
    });

    res.status(201).json({ expense });
    eventStreamHub.notifyEventChanged(db, id, { reason: 'expense_created', expenseId: expense.id });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Erro ao registrar gasto' });
  }
});

// Update expense
router.put('/expenses/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { description, amount, payerId, splitMode, splits } = req.body || {};

    const db = getDb();
    const expense = getExpenseById(db, id);
    if (!expense) return res.status(404).json({ error: 'Gasto não encontrado' });
    if (!isEventMember(db, expense.event_id, req.user.id)) return res.status(403).json({ error: 'Acesso restrito aos participantes do evento' });

    const updated = updateExpense(db, id, {
      description,
      amount,
      payerId,
      splitMode: splitMode || 'EQUAL_ALL',
      splits: splits || [],
    });
    recordActivityLog(db, {
      eventType: 'expense_updated',
      userId: req.user.id,
      eventId: expense.event_id,
      metadata: { amount: updated.amount, split_mode: updated.split_mode },
    });

    res.json({ expense: updated });
    eventStreamHub.notifyEventChanged(db, expense.event_id, { reason: 'expense_updated', expenseId: id });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Erro ao atualizar gasto' });
  }
});

// Delete expense
router.delete('/expenses/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();
    const expense = getExpenseById(db, id);
    if (!expense) return res.status(404).json({ error: 'Gasto não encontrado' });
    if (!isEventMember(db, expense.event_id, req.user.id)) return res.status(403).json({ error: 'Acesso restrito aos participantes do evento' });

    deleteExpense(db, id);
    recordActivityLog(db, {
      eventType: 'expense_deleted',
      userId: req.user.id,
      eventId: expense.event_id,
      metadata: { amount: expense.amount, split_mode: expense.split_mode },
    });
    res.json({ ok: true });
    eventStreamHub.notifyEventChanged(db, expense.event_id, { reason: 'expense_deleted', expenseId: id });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Erro ao excluir gasto' });
  }
});

export default router;
