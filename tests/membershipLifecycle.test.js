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

function createServer() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  initSchema(db);
  setDb(db);

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);

  const api = express.Router();
  api.use('/auth', authRoutes);
  api.use('/events', eventRoutes);
  api.use('/expenses', expenseRoutes);
  api.use('/', settlementRoutes);
  api.use('/', expenseRoutes);
  app.use('/api', api);

  return { app, db };
}

test('Event leave, reclaim, timeline pills, admin-only add, and participant removal with Option 1', async (t) => {
  const { app } = createServer();
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  t.after(() => server.close());

  // Register admin + two guests
  const reg = async (username, name) => {
    const res = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'secret123', name }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    return { cookie: res.headers.get('set-cookie'), user: body.user };
  };

  const admin = await reg('admin_u', 'Admin Criador');
  const felipe = await reg('felipe_u', 'Felipe Yamahata');
  const carol = await reg('carol_u', 'Carol Souza');

  // Upload avatar for Felipe so we verify post-leave avatar access for event members
  let res = await fetch(`${baseUrl}/auth/avatar`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: felipe.cookie },
    body: JSON.stringify({ image: 'data:image/jpeg;base64,/9j/AAAA' }),
  });
  assert.equal(res.status, 200);

  // Admin creates event
  res = await fetch(`${baseUrl}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
    body: JSON.stringify({ title: 'Churrasco S10e' }),
  });
  assert.equal(res.status, 201);
  const { event } = await res.json();
  const adminPtId = event.creatorParticipant.id;

  // Felipe & Carol join
  res = await fetch(`${baseUrl}/events/${event.id}/join`, { method: 'POST', headers: { Cookie: felipe.cookie } });
  assert.equal(res.status, 201);
  const { participant: felipePt } = await res.json();

  res = await fetch(`${baseUrl}/events/${event.id}/join`, { method: 'POST', headers: { Cookie: carol.cookie } });
  assert.equal(res.status, 201);
  const { participant: carolPt } = await res.json();

  // Guest cannot add generic participant (admin only)
  res = await fetch(`${baseUrl}/events/${event.id}/participants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: felipe.cookie },
    body: JSON.stringify({ name: 'Intruso' }),
  });
  assert.equal(res.status, 403);

  // Admin can add generic participant
  res = await fetch(`${baseUrl}/events/${event.id}/participants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
    body: JSON.stringify({ name: 'Convidado Manual' }),
  });
  assert.equal(res.status, 201);
  const { participant: manualPt } = await res.json();

  // Log a SHARES expense paid by Felipe (total 12000: admin=2, felipe=1, carol=1, manual=0 -> excluded)
  res = await fetch(`${baseUrl}/events/${event.id}/expenses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: felipe.cookie },
    body: JSON.stringify({
      description: 'Carne',
      amount: 12000,
      payerId: felipePt.id,
      splitMode: 'SHARES',
      splits: [
        { participant_id: adminPtId, shares: 2 },
        { participant_id: felipePt.id, shares: 1 },
        { participant_id: carolPt.id, shares: 1 },
      ],
    }),
  });
  assert.equal(res.status, 201);

  // Carol records a payment to Felipe
  res = await fetch(`${baseUrl}/events/${event.id}/settlements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: carol.cookie },
    body: JSON.stringify({
      fromParticipantId: carolPt.id,
      toParticipantId: felipePt.id,
      amount: 3000,
      notes: 'Pix carne',
    }),
  });
  assert.equal(res.status, 201);

  // Creator cannot leave own event
  res = await fetch(`${baseUrl}/events/${event.id}/leave`, { method: 'POST', headers: { Cookie: admin.cookie } });
  assert.equal(res.status, 403);

  // Felipe leaves event -> leaves generic participant behind + records PARTICIPANT_LEFT
  res = await fetch(`${baseUrl}/events/${event.id}/leave`, { method: 'POST', headers: { Cookie: felipe.cookie } });
  assert.equal(res.status, 200);
  const leaveBody = await res.json();
  assert.equal(leaveBody.participant.user_id, null);
  assert.equal(leaveBody.participant.name, 'Felipe Yamahata');
  assert.equal(leaveBody.timelineEntry.type, 'PARTICIPANT_LEFT');

  // Event disappears from Felipe's event list
  res = await fetch(`${baseUrl}/events`, { headers: { Cookie: felipe.cookie } });
  assert.equal((await res.json()).events.some(e => e.id === event.id), false);

  // Admin can still fetch Felipe's avatar for the feed pill
  res = await fetch(`${baseUrl}/auth/avatar/${felipe.user.id}`, { headers: { Cookie: admin.cookie } });
  assert.equal(res.status, 200);

  // Timeline contains JOINED (x2) and LEFT (x1)
  res = await fetch(`${baseUrl}/events/${event.id}/expenses`, { headers: { Cookie: admin.cookie } });
  const feedData = await res.json();
  assert.ok(feedData.timelineEvents.some(e => e.type === 'PARTICIPANT_LEFT' && e.actor_avatar_version));
  assert.equal(feedData.timelineEvents.filter(e => e.type === 'PARTICIPANT_JOINED').length, 2);

  // Felipe returns via invite code and reclaims his generic slot
  res = await fetch(`${baseUrl}/events/${event.code}`, { headers: { Cookie: felipe.cookie } });
  const inviteData = await res.json();
  assert.equal(inviteData.currentParticipant, null);
  assert.ok(inviteData.unclaimedParticipants.some(p => p.id === felipePt.id));

  res = await fetch(`${baseUrl}/events/${event.id}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: felipe.cookie },
    body: JSON.stringify({ participantId: felipePt.id }),
  });
  assert.equal(res.status, 200);

  res = await fetch(`${baseUrl}/events/${event.id}/expenses`, { headers: { Cookie: admin.cookie } });
  assert.ok((await res.json()).timelineEvents.some(e => e.type === 'PARTICIPANT_CLAIMED' && e.placeholder_name === 'Felipe Yamahata'));

  // Non-admin cannot remove participants
  res = await fetch(`${baseUrl}/events/${event.id}/participants/${manualPt.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Cookie: carol.cookie },
  });
  assert.equal(res.status, 403);

  // Admin previews Felipe removal (has 1 paid expense and 1 settlement)
  res = await fetch(`${baseUrl}/events/${event.id}/participants/${felipePt.id}/removal-preview`, {
    headers: { Cookie: admin.cookie },
  });
  assert.equal(res.status, 200);
  const { preview } = await res.json();
  assert.equal(preview.paidExpensesCount, 1);
  assert.equal(preview.settlementsCount, 1);
  assert.equal(preview.redistributedExpensesCount, 1);

  // Removing without replacementPayerId fails when paidExpensesCount > 0
  res = await fetch(`${baseUrl}/events/${event.id}/participants/${felipePt.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);

  // Admin removes Felipe reassigning paid expenses to Admin (Option 1: settlement reversed, split redistributed)
  // Before: admin=6000 (2 shares), felipe=3000 (1 share), carol=3000 (1 share)
  // Remove Felipe (3000) -> +1500 each -> admin=7500, carol=4500 (paid by admin=12000)
  // Net: admin = 12000 - 7500 = +4500; carol = -4500; manual = 0
  res = await fetch(`${baseUrl}/events/${event.id}/participants/${felipePt.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
    body: JSON.stringify({ replacementPayerId: adminPtId }),
  });
  assert.equal(res.status, 200);

  res = await fetch(`${baseUrl}/events/${event.id}/balances`, { headers: { Cookie: admin.cookie } });
  const balAfter = await res.json();
  assert.equal(balAfter.settlements.length, 0);
  assert.equal(balAfter.userSummary.netBalance, 4500);
  assert.equal(balAfter.balances.find(b => b.id === carolPt.id).netBalance, -4500);
  assert.equal(balAfter.balances.find(b => b.id === manualPt.id).netBalance, 0);
});
