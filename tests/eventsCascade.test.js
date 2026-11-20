import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import { DatabaseSync } from 'node:sqlite';
import { setDb } from '../src/db/connection.js';
import { initSchema } from '../src/db/schema.js';
import { authMiddleware } from '../src/middleware/auth.js';
import authRoutes from '../src/routes/auth.js';
import eventRoutes from '../src/routes/events.js';
import expenseRoutes from '../src/routes/expenses.js';
import settlementRoutes from '../src/routes/settlements.js';

function createTestServer() {
  const testDb = new DatabaseSync(':memory:');
  testDb.exec('PRAGMA foreign_keys = ON;');
  initSchema(testDb);
  setDb(testDb);

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);

  const apiRouter = express.Router();
  apiRouter.use('/auth', authRoutes);
  apiRouter.use('/events', eventRoutes);
  apiRouter.use('/expenses', expenseRoutes);
  apiRouter.use('/', settlementRoutes);
  apiRouter.use('/', expenseRoutes);
  app.use('/api', apiRouter);

  return { app, testDb };
}

test('DELETE /api/events/:id rejects guests and cascades all event child tables for creator', async (t) => {
  const { app, testDb } = createTestServer();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  t.after(() => server.close());

  let res = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'creator_u', password: 'secret123', name: 'Criador' }),
  });
  const creatorCookie = res.headers.get('set-cookie');

  res = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'guest_u', password: 'secret123', name: 'Convidado' }),
  });
  const guestCookie = res.headers.get('set-cookie');

  // Create target event and a second control event
  res = await fetch(`${baseUrl}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: creatorCookie },
    body: JSON.stringify({ title: 'Evento para excluir' }),
  });
  const { event: targetEvent } = await res.json();

  res = await fetch(`${baseUrl}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: creatorCookie },
    body: JSON.stringify({ title: 'Evento preservado' }),
  });
  const { event: keepEvent } = await res.json();

  // Guest joins target event
  res = await fetch(`${baseUrl}/events/${targetEvent.id}/join`, {
    method: 'POST',
    headers: { Cookie: guestCookie },
  });
  assert.equal(res.status, 201);
  const { participant: guestParticipant } = await res.json();

  // Add placeholder participant, expense + splits, and settlement on target event
  res = await fetch(`${baseUrl}/events/${targetEvent.id}/participants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: creatorCookie },
    body: JSON.stringify({ name: 'Placeholder' }),
  });
  assert.equal(res.status, 201);

  res = await fetch(`${baseUrl}/events/${targetEvent.id}/expenses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: creatorCookie },
    body: JSON.stringify({
      description: 'Carne',
      amount: 12000,
      payerId: targetEvent.creatorParticipant.id,
      splitMode: 'SUBSET_EQUAL',
      splits: [
        { participant_id: targetEvent.creatorParticipant.id },
        { participant_id: guestParticipant.id },
      ],
    }),
  });
  assert.equal(res.status, 201);
  const { expense } = await res.json();

  res = await fetch(`${baseUrl}/events/${targetEvent.id}/settlements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: guestCookie },
    body: JSON.stringify({
      fromParticipantId: guestParticipant.id,
      toParticipantId: targetEvent.creatorParticipant.id,
      amount: 3000,
      notes: 'Pix',
    }),
  });
  assert.equal(res.status, 201);

  // Unauthenticated and joined guest attempts must be rejected
  res = await fetch(`${baseUrl}/events/${targetEvent.id}`, { method: 'DELETE' });
  assert.equal(res.status, 401);

  res = await fetch(`${baseUrl}/events/${targetEvent.id}`, {
    method: 'DELETE',
    headers: { Cookie: guestCookie },
  });
  assert.equal(res.status, 403);

  // Verify child rows exist before creator delete
  assert.equal(
    testDb.prepare('SELECT COUNT(*) AS count FROM participants WHERE event_id = ?').get(targetEvent.id).count,
    3,
  );
  assert.equal(
    testDb.prepare('SELECT COUNT(*) AS count FROM expenses WHERE event_id = ?').get(targetEvent.id).count,
    1,
  );
  assert.equal(
    testDb.prepare('SELECT COUNT(*) AS count FROM expense_splits WHERE expense_id = ?').get(expense.id).count > 0,
    true,
  );
  assert.equal(
    testDb.prepare('SELECT COUNT(*) AS count FROM settlements WHERE event_id = ?').get(targetEvent.id).count,
    1,
  );

  // Creator deletes target event
  res = await fetch(`${baseUrl}/events/${targetEvent.id}`, {
    method: 'DELETE',
    headers: { Cookie: creatorCookie },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);

  // Assert full cascade removal of target event and all child rows
  assert.equal(testDb.prepare('SELECT COUNT(*) AS count FROM events WHERE id = ?').get(targetEvent.id).count, 0);
  assert.equal(testDb.prepare('SELECT COUNT(*) AS count FROM participants WHERE event_id = ?').get(targetEvent.id).count, 0);
  assert.equal(testDb.prepare('SELECT COUNT(*) AS count FROM expenses WHERE event_id = ?').get(targetEvent.id).count, 0);
  assert.equal(testDb.prepare('SELECT COUNT(*) AS count FROM expense_splits WHERE expense_id = ?').get(expense.id).count, 0);
  assert.equal(testDb.prepare('SELECT COUNT(*) AS count FROM settlements WHERE event_id = ?').get(targetEvent.id).count, 0);
  assert.equal(testDb.prepare('SELECT COUNT(*) AS count FROM event_activity WHERE event_id = ?').get(targetEvent.id).count, 0);

  // Assert control event was untouched
  assert.equal(testDb.prepare('SELECT COUNT(*) AS count FROM events WHERE id = ?').get(keepEvent.id).count, 1);
  assert.equal(testDb.prepare('SELECT COUNT(*) AS count FROM participants WHERE event_id = ?').get(keepEvent.id).count, 1);
});
