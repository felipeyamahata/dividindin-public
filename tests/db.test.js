import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/db/connection.js';
import { createUser, authenticateUser } from '../src/db/users.js';
import { createEvent, getEventByCode, listUserEvents } from '../src/db/events.js';
import { addParticipant, getParticipantsByEvent, claimParticipant } from '../src/db/participants.js';
import { createExpense, getExpensesByEvent, updateExpense } from '../src/db/expenses.js';
import { createSettlement, getSettlementsByEvent, updateSettlement } from '../src/db/settlements.js';
import { calculateBalances, simplifyDebts, computeSettlementBreakdowns } from '../src/domain/settlement.js';

test('Full DB Integration: User, Event, Placeholder, Claim, Expense, and Settlement', () => {
  const db = getDb(':memory:');

  // 1. Create User
  const user1 = createUser(db, { username: 'felipe', password: 'secret123', name: 'Felipe Yamahata' });
  assert.ok(user1.id.startsWith('usr_'));
  assert.equal(user1.username, 'felipe');

  const auth = authenticateUser(db, 'felipe', 'secret123');
  assert.ok(auth);
  assert.equal(auth.name, 'Felipe Yamahata');

  // 2. Create Event
  const event = createEvent(db, {
    title: 'Viagem Ilhabela',
    description: 'Fim de semana dos amigos',
    createdBy: user1.id,
    creatorName: user1.name,
  });
  assert.ok(event.id.startsWith('ev_'));
  assert.ok(event.code.length >= 6);

  // Felipe should already be a participant
  const participantsAfterEvent = getParticipantsByEvent(db, event.id);
  assert.equal(participantsAfterEvent.length, 1);
  assert.equal(participantsAfterEvent[0].user_id, user1.id);
  assert.equal(participantsAfterEvent[0].name, 'Felipe Yamahata');

  // 3. Add placeholder participant "Dani" (no account yet)
  const placeholderDani = addParticipant(db, {
    eventId: event.id,
    userId: null,
    name: 'Dani',
  });
  assert.equal(placeholderDani.user_id, null);
  assert.equal(placeholderDani.name, 'Dani');

  // 4. Felipe registers an expense of R$ 100,00 split equally among all
  const exp1 = createExpense(db, {
    eventId: event.id,
    description: 'Pedágio',
    amount: 10000,
    payerId: participantsAfterEvent[0].id,
    splitMode: 'EQUAL_ALL',
    createdBy: user1.id,
  });
  assert.ok(exp1.id.startsWith('exp_'));

  // Balances right now (2 participants: Felipe and Dani)
  let participants = getParticipantsByEvent(db, event.id);
  let expenses = getExpensesByEvent(db, event.id);
  let balances = calculateBalances(participants, expenses, []);
  assert.equal(balances.get(participantsAfterEvent[0].id).netBalance, 5000);
  assert.equal(balances.get(placeholderDani.id).netBalance, -5000);

  // 5. User 2 (Daniel) registers and claims the placeholder "Dani"
  const user2 = createUser(db, { username: 'daniel', password: 'secret123', name: 'Daniel Mendes' });
  const claimed = claimParticipant(db, {
    participantId: placeholderDani.id,
    userId: user2.id,
    userName: user2.name,
  });
  assert.equal(claimed.user_id, user2.id);
  assert.equal(claimed.name, 'Daniel Mendes');

  // 6. Daniel pays Felipe R$ 50,00
  const settlement = createSettlement(db, {
    eventId: event.id,
    fromParticipantId: claimed.id,
    toParticipantId: participantsAfterEvent[0].id,
    amount: 5000,
    notes: 'Pix recebido',
  });
  assert.ok(settlement.id.startsWith('stl_'));

  // 7. Verify balances: both should now be 0 (quitados!)
  participants = getParticipantsByEvent(db, event.id);
  expenses = getExpensesByEvent(db, event.id);
  const settlements = getSettlementsByEvent(db, event.id);
  balances = calculateBalances(participants, expenses, settlements);

  assert.equal(balances.get(participantsAfterEvent[0].id).netBalance, 0);
  assert.equal(balances.get(claimed.id).netBalance, 0);

  const txs = simplifyDebts(balances);
  assert.equal(txs.length, 0); // No pending debts!
});


test('Invalid divisions are rejected without modifying expenses', () => {
  const db = getDb(':memory:');
  const user = createUser(db, { username: 'test', password: 'secret123', name: 'Teste' });
  const event = createEvent(db, { title: 'Teste', createdBy: user.id, creatorName: user.name });
  const payer = event.creatorParticipant.id;
  const expense = createExpense(db, { eventId: event.id, description: 'Original', amount: 100, payerId: payer });
  assert.throws(() => updateExpense(db, expense.id, { description: 'Alterado', amount: 100, payerId: payer, splitMode: 'EXACT_AMOUNTS', splits: [{ participant_id: payer, allocated_amount: 20 }] }));
  assert.equal(getExpensesByEvent(db, event.id)[0].description, 'Original');
  assert.throws(() => createExpense(db, { eventId: event.id, description: 'Inválido', amount: 100, payerId: payer, splitMode: 'SUBSET_EQUAL', splits: [{ participant_id: 'unknown' }] }));
  assert.equal(getExpensesByEvent(db, event.id).length, 1);
  db.exec("CREATE TRIGGER fail_split BEFORE INSERT ON expense_splits BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;");
  assert.throws(() => updateExpense(db, expense.id, { description: 'Alterado', amount: 100, payerId: payer, splitMode: 'SUBSET_EQUAL', splits: [{ participant_id: payer }] }));
  const restored = getExpensesByEvent(db, event.id)[0];
  assert.equal(restored.description, 'Original');
  assert.equal(restored.split_mode, 'EQUAL_ALL');
});

test('Event list follows edits and includes expense summaries', () => {
  const db = getDb(':memory:');
  const user = createUser(db, { username: 'activity', password: 'secret123', name: 'Activity' });
  const first = createEvent(db, { title: 'First', createdBy: user.id, creatorName: user.name });
  const second = createEvent(db, { title: 'Second', createdBy: user.id, creatorName: user.name });
  const expense = createExpense(db, { eventId: first.id, description: 'Dinner', amount: 4200, payerId: first.creatorParticipant.id });
  db.prepare('UPDATE event_activity SET updated_at = ? WHERE event_id = ?').run('2000-01-01T00:00:00.000Z', first.id);
  db.prepare('UPDATE event_activity SET updated_at = ? WHERE event_id = ?').run('2001-01-01T00:00:00.000Z', second.id);
  assert.equal(listUserEvents(db, user.id)[0].id, second.id);
  updateExpense(db, expense.id, { description: 'Dinner edited', amount: 4500, payerId: first.creatorParticipant.id });
  const [recent] = listUserEvents(db, user.id);
  assert.equal(recent.id, first.id);
  assert.equal(recent.participant_count, 1);
  assert.equal(recent.total_expenses, 4500);
  assert.equal(recent.latest_expense_description, 'Dinner edited');
  assert.equal(recent.latest_expense_amount, 4500);
});

test('Settlement breakdown dynamically reflects prior edits while ignoring subsequent expenses', () => {
  const db = getDb(':memory:');
  const felipe = createUser(db, { username: 'felipe_dyn', password: 'secret123', name: 'Felipe' });
  const event = createEvent(db, { title: 'Churras', createdBy: felipe.id, creatorName: felipe.name });
  const pFelipe = event.creatorParticipant.id;
  const pCarlos = addParticipant(db, { eventId: event.id, name: 'Carlos' }).id;

  // Prior expense: Carlos pays R$ 40 -> Felipe owes R$ 20
  const exp1 = createExpense(db, {
    eventId: event.id,
    description: 'Carvão',
    amount: 4000,
    payerId: pCarlos,
    createdBy: felipe.id,
  });
  db.prepare('UPDATE expenses SET created_at = ? WHERE id = ?').run('2026-11-16T20:00:00.000Z', exp1.id);

  // Felipe pays Carlos R$ 50
  const stl1 = createSettlement(db, {
    eventId: event.id,
    fromParticipantId: pFelipe,
    toParticipantId: pCarlos,
    amount: 5000,
    createdBy: felipe.id,
  });
  db.prepare('UPDATE settlements SET created_at = ? WHERE id = ?').run('2026-11-16T20:51:00.000Z', stl1.id);

  // Later expense (after settlement): Carlos pays R$ 200 -> must NOT affect stl1 breakdown
  const exp2 = createExpense(db, {
    eventId: event.id,
    description: 'Picanha',
    amount: 20000,
    payerId: pCarlos,
    createdBy: felipe.id,
  });
  db.prepare('UPDATE expenses SET created_at = ? WHERE id = ?').run('2026-11-16T21:00:00.000Z', exp2.id);

  const participants = getParticipantsByEvent(db, event.id);
  const settlements = getSettlementsByEvent(db, event.id);

  const beforeEdit = computeSettlementBreakdowns({
    participants,
    expenses: getExpensesByEvent(db, event.id),
    settlements,
  });
  assert.deepEqual(beforeEdit.get(stl1.id), {
    amountCents: 5000,
    debtBeforeCents: 2000,
    settledCents: 2000,
    creditedCents: 3000,
    remainingCents: 0,
  });

  // Edit prior expense exp1 (R$ 40 -> R$ 100) -> stl1 breakdown recalculates to devia R$ 50 / quitou R$ 50 / creditou R$ 0 / resta R$ 0
  updateExpense(db, exp1.id, {
    description: 'Carvão premium',
    amount: 10000,
    payerId: pCarlos,
  });
  const afterEdit = computeSettlementBreakdowns({
    participants,
    expenses: getExpensesByEvent(db, event.id),
    settlements,
  });
  assert.deepEqual(afterEdit.get(stl1.id), {
    amountCents: 5000,
    debtBeforeCents: 5000,
    settledCents: 5000,
    creditedCents: 0,
    remainingCents: 0,
  });

  // Update settlement preserves created_at while changing amount/notes
  const updatedStl = updateSettlement(db, stl1.id, {
    fromParticipantId: pFelipe,
    toParticipantId: pCarlos,
    amount: 3000,
    notes: 'Ajustado',
  });
  assert.equal(updatedStl.amount, 3000);
  assert.equal(updatedStl.notes, 'Ajustado');
  assert.equal(updatedStl.created_at, '2026-11-16T20:51:00.000Z');
});
