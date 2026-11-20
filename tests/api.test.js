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

test('Full HTTP API Flow', async (t) => {
  // Fresh isolated in-memory DB for this test
  const testDb = new DatabaseSync(':memory:');
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

  app.use('/divide/api', apiRouter);
  app.use('/api', apiRouter);

  // Start server on ephemeral port
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/divide/api`;

  t.after(() => server.close());

  // 1. Register User A
  let res = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ana', password: 'secret123', name: 'Ana Paula' }),
  });
  assert.equal(res.status, 201);
  const cookieA = res.headers.get('set-cookie');
  const userA = await res.json();
  assert.equal(userA.user.username, 'ana');

  const authHeaders = { 'Content-Type': 'application/json', Cookie: cookieA };
  res = await fetch(`${baseUrl}/auth/profile`, { method: 'PUT', headers: authHeaders, body: JSON.stringify({ name: 'Ana Silva' }) });
  assert.equal((await res.json()).user.name, 'Ana Silva');
  res = await fetch(`${baseUrl}/auth/avatar`, { method: 'PUT', headers: authHeaders, body: JSON.stringify({ image: 'data:image/jpeg;base64,/9j/AAAA' }) });
  const firstAvatar = await res.json();
  assert.ok(firstAvatar.user.avatar_version);
  res = await fetch(`${baseUrl}/auth/avatar`, { method: 'PUT', headers: authHeaders, body: JSON.stringify({ image: 'data:image/jpeg;base64,/9j/BBBB' }) });
  const secondAvatar = await res.json();
  assert.notEqual(firstAvatar.user.avatar_version, secondAvatar.user.avatar_version);
  res = await fetch(`${baseUrl}/auth/avatar`, { headers: authHeaders });
  assert.equal((await res.json()).avatar.image, 'data:image/jpeg;base64,/9j/BBBB');
  res = await fetch(`${baseUrl}/auth/password`, { method: 'PUT', headers: authHeaders, body: JSON.stringify({ currentPassword: 'wrongpass', newPassword: 'newsecret123' }) });
  assert.equal(res.status, 400);
  res = await fetch(`${baseUrl}/auth/password`, { method: 'PUT', headers: authHeaders, body: JSON.stringify({ currentPassword: 'secret123', newPassword: 'newsecret123' }) });
  assert.equal(res.status, 200);
  assert.equal(testDb.prepare('SELECT COUNT(*) AS count FROM user_avatars WHERE user_id = ?').get(userA.user.id).count, 1);

  // 2. Create Event
  res = await fetch(`${baseUrl}/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieA,
    },
    body: JSON.stringify({ title: 'Jantar Mexicano' }),
  });
  assert.equal(res.status, 201);
  const { event } = await res.json();
  assert.equal(event.title, 'Jantar Mexicano');

  res = await fetch(`${baseUrl}/events/${event.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Intruso', description: '' }) });
  assert.equal(res.status, 401);
  res = await fetch(`${baseUrl}/events/${event.id}`, { method: 'PUT', headers: authHeaders, body: JSON.stringify({ title: 'Jantar Mexicano', description: 'Noite com amigos' }) });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).event.description, 'Noite com amigos');

  // 2b. Fetch Event specifically by its 6-character short code!
  res = await fetch(`${baseUrl}/events/${event.code}`);
  assert.equal(res.status, 200);
  const fetchedByCode = await res.json();
  assert.equal(fetchedByCode.event.title, 'Jantar Mexicano');

  // Anonymous visitors cannot modify financial data or add participants.
  res = await fetch(`${baseUrl}/events/${event.id}/participants`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Intruso' }) });
  assert.equal(res.status, 401);
  res = await fetch(`${baseUrl}/events/${event.id}/balances`);
  assert.equal(res.status, 401);

  // 3. Add placeholder participant "Beto"
  res = await fetch(`${baseUrl}/events/${event.id}/participants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookieA },
    body: JSON.stringify({ name: 'Beto' }),
  });
  assert.equal(res.status, 201);
  const { participant: betoPlaceholder } = await res.json();
  assert.equal(betoPlaceholder.name, 'Beto');

  // 4. Register User B and claim Beto
  res = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'roberto', password: 'secret123', name: 'Roberto Lima' }),
  });
  const cookieB = res.headers.get('set-cookie');

  res = await fetch(`${baseUrl}/events/${event.id}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieB,
    },
    body: JSON.stringify({ participantId: betoPlaceholder.id }),
  });
  assert.equal(res.status, 200);
  const { participant: claimedBeto } = await res.json();
  assert.equal(claimedBeto.name, 'Roberto Lima');
  assert.ok(claimedBeto.user_id);

  // 5. Ana logs an expense of R$ 120,00 split equally
  res = await fetch(`${baseUrl}/events/${event.id}`);
  const eventDetails = await res.json();
  const anaPt = eventDetails.participants.find(p => p.name === 'Ana Silva');

  res = await fetch(`${baseUrl}/events/${event.id}/expenses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieA,
    },
    body: JSON.stringify({
      description: 'Nachos e Tacos',
      amount: 12000,
      payerId: anaPt.id,
      splitMode: 'EQUAL_ALL',
    }),
  });
  assert.equal(res.status, 201);
  const { expense: createdExp } = await res.json();

  // 6. Check Balances
  res = await fetch(`${baseUrl}/events/${event.id}/balances`, {
    headers: { 'Cookie': cookieB },
  });
  const balanceData = await res.json();
  assert.equal(balanceData.totalSpent, 12000);
  assert.equal(balanceData.userSummary.netBalance, -6000); // Roberto owes R$ 60,00
  assert.equal(balanceData.simplifiedTransactions.length, 1);
  assert.equal(balanceData.simplifiedTransactions[0].amount, 6000);

  res = await fetch(`${baseUrl}/events`, { headers: { Cookie: cookieB } });
  const listedEvent = (await res.json()).events.find(item => item.id === event.id);
  assert.equal(listedEvent.user_balance, -6000);
  assert.equal(listedEvent.participants.length, 2);
  assert.equal(listedEvent.participants.find(item => item.user_id === userA.user.id).avatar_version, secondAvatar.user.avatar_version);
  res = await fetch(`${baseUrl}/auth/avatar/${userA.user.id}`, { headers: { Cookie: cookieB } });
  assert.equal(res.status, 200);

  // 7. Roberto pays Ana R$ 60,00
  res = await fetch(`${baseUrl}/events/${event.id}/settlements`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieB,
    },
    body: JSON.stringify({
      fromParticipantId: claimedBeto.id,
      toParticipantId: anaPt.id,
      amount: 6000,
      notes: 'Pix enviado',
    }),
  });
  assert.equal(res.status, 201);
  const { settlement: createdSettlement } = await res.json();

  // 7b. Edit settlement and verify updated amount/notes & preserved created_at, then restore R$ 60,00
  res = await fetch(`${baseUrl}/settlements/${createdSettlement.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieB,
    },
    body: JSON.stringify({
      fromParticipantId: claimedBeto.id,
      toParticipantId: anaPt.id,
      amount: 4500,
      notes: 'Pix parcial',
    }),
  });
  assert.equal(res.status, 200);
  const { settlement: editedSettlement } = await res.json();
  assert.equal(editedSettlement.amount, 4500);
  assert.equal(editedSettlement.notes, 'Pix parcial');
  assert.equal(editedSettlement.created_at, createdSettlement.created_at);

  res = await fetch(`${baseUrl}/settlements/${createdSettlement.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieB,
    },
    body: JSON.stringify({
      fromParticipantId: claimedBeto.id,
      toParticipantId: anaPt.id,
      amount: 6000,
      notes: 'Pix enviado',
    }),
  });
  assert.equal(res.status, 200);

  // 8. Re-check balances: All debts settled!
  res = await fetch(`${baseUrl}/events/${event.id}/balances`, {
    headers: { 'Cookie': cookieB },
  });
  let finalBalances = await res.json();
  assert.equal(finalBalances.userSummary.netBalance, 0);
  assert.equal(finalBalances.simplifiedTransactions.length, 0);
  res = await fetch(`${baseUrl}/events`, { headers: { Cookie: cookieB } });
  assert.equal((await res.json()).events.find(item => item.id === event.id).user_balance, 0);

  // 9. Edit Expense to SHARES split mode: R$ 200,00 (Ana: 1 parte, Roberto: 3 partes = total 4 partes)
  res = await fetch(`${baseUrl}/expenses/${createdExp.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieA,
    },
    body: JSON.stringify({
      description: 'Nachos, Tacos e Bebidas (Editado)',
      amount: 20000,
      payerId: anaPt.id,
      splitMode: 'SHARES',
      splits: [
        { participant_id: anaPt.id, shares: 1 },
        { participant_id: claimedBeto.id, shares: 3 },
      ],
    }),
  });
  assert.equal(res.status, 200);
  const { expense: updatedExp } = await res.json();
  assert.equal(updatedExp.description, 'Nachos, Tacos e Bebidas (Editado)');
  assert.equal(updatedExp.amount, 20000);
  assert.equal(updatedExp.split_mode, 'SHARES');

  // Verify recalculated balances with shares!
  res = await fetch(`${baseUrl}/events/${event.id}/balances`, {
    headers: { 'Cookie': cookieB },
  });
  finalBalances = await res.json();
  assert.equal(finalBalances.totalSpent, 20000);
  assert.equal(finalBalances.userSummary.netBalance, -9000);

  // Non-creator member cannot edit event; logged-in outsider cannot delete another event.
  res = await fetch(`${baseUrl}/events/${event.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookieB }, body: JSON.stringify({ title: 'Tentativa', description: '' }) });
  assert.equal(res.status, 403);
  res = await fetch(`${baseUrl}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'outsider', password: 'secret123', name: 'Outro' }) });
  const outsiderCookie = res.headers.get('set-cookie');
  res = await fetch(`${baseUrl}/events/${event.id}`, { method: 'DELETE', headers: { Cookie: outsiderCookie } });
  assert.equal(res.status, 403);
  res = await fetch(`${baseUrl}/expenses/${createdExp.id}`, { method: 'DELETE', headers: { Cookie: outsiderCookie } });
  assert.equal(res.status, 403);
  res = await fetch(`${baseUrl}/settlements/${createdSettlement.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: outsiderCookie },
    body: JSON.stringify({ fromParticipantId: claimedBeto.id, toParticipantId: anaPt.id, amount: 1000 }),
  });
  assert.equal(res.status, 403);
  res = await fetch(`${baseUrl}/expenses/${createdExp.id}`, { method: 'DELETE' });
  assert.equal(res.status, 401);
  res = await fetch(`${baseUrl}/auth/logout`, { method: 'POST', headers: { Cookie: outsiderCookie } });
  assert.equal(res.status, 200);
  res = await fetch(`${baseUrl}/auth/me`, { headers: { Cookie: outsiderCookie } });
  assert.equal((await res.json()).user, null);

  // 10. Delete Event
  res = await fetch(`${baseUrl}/events/${event.id}`, {
    method: 'DELETE',
    headers: { 'Cookie': cookieA },
  });
  assert.equal(res.status, 200);

  // Check event is deleted
  res = await fetch(`${baseUrl}/events/${event.id}`);
  assert.equal(res.status, 404);

  // 11. Verify lightweight telemetry & client_mode tracking
  res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ana', password: 'wrong-password' }),
  });
  assert.equal(res.status, 401);

  res = await fetch(`${baseUrl}/auth/me`, {
    headers: { Cookie: cookieA, 'X-Client-Mode': 'pwa' },
  });
  assert.equal(res.status, 200);

  res = await fetch(`${baseUrl}/auth/telemetry/pwa-installed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA, 'X-Client-Mode': 'pwa' },
    body: JSON.stringify({ source: 'appinstalled' }),
  });
  assert.equal(res.status, 200);

  const pwaSession = testDb.prepare("SELECT COUNT(*) AS count FROM sessions WHERE client_mode = 'pwa'").get();
  assert.equal(pwaSession.count, 1);
  const loggedTypes = testDb.prepare('SELECT event_type FROM activity_logs').all().map((r) => r.event_type);
  assert.ok(loggedTypes.includes('user_registered'));
  assert.ok(loggedTypes.includes('event_created'));
  assert.ok(loggedTypes.includes('event_deleted'));
  assert.ok(loggedTypes.includes('expense_created'));
  assert.ok(loggedTypes.includes('settlement_created'));
  assert.ok(loggedTypes.includes('login_failed'));
  assert.ok(loggedTypes.includes('pwa_installed'));
});
