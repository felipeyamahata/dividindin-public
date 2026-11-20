import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import { DatabaseSync } from 'node:sqlite';

import { setDb } from '../src/db/connection.js';
import { initSchema } from '../src/db/schema.js';
import { createUser } from '../src/db/users.js';
import { createEvent } from '../src/db/events.js';
import { authMiddleware } from '../src/middleware/auth.js';
import { createAuthRouter } from '../src/routes/auth.js';
import eventRoutes from '../src/routes/events.js';
import expenseRoutes from '../src/routes/expenses.js';
import {
  buildAvatarSignature,
  computeReconnectDelayMs,
  createSseParser,
  diffEventSnapshot,
  formatNewEntriesLabel,
} from '../src/domain/eventSync.js';
import { createEventStreamHub, eventStreamHub } from '../src/domain/eventStreamHub.js';

test('diffEventSnapshot detects new feed entries, title change, and participant updates', () => {
  const prev = {
    eventTitle: 'Churras',
    participants: [
      { id: 'p1', user_id: 'u1', name: 'Ana', avatar_version: 'v1' },
      { id: 'p2', user_id: null, name: 'Convidado', avatar_version: null },
    ],
    expenseIds: ['e1'],
    settlementIds: ['s1'],
    timelineIds: ['t1'],
  };
  const next = {
    eventTitle: 'Churrasco na casa da Ana no fim de semana',
    participants: [
      { id: 'p1', user_id: 'u1', name: 'Ana Paula', avatar_version: 'v2' },
      { id: 'p2', user_id: null, name: 'Convidado', avatar_version: null },
    ],
    expenseIds: ['e2', 'e1'],
    settlementIds: ['s1'],
    timelineIds: ['t2', 't1'],
  };

  const diff = diffEventSnapshot(prev, next);
  assert.deepEqual(diff.addedExpenseIds, ['e2']);
  assert.deepEqual(diff.addedSettlementIds, []);
  assert.deepEqual(diff.addedTimelineIds, ['t2']);
  assert.deepEqual(diff.addedFeedIds, ['e2', 't2']);
  assert.equal(diff.titleChanged, true);
  assert.deepEqual(diff.updatedParticipants, [
    { participantId: 'p1', userId: 'u1', nameChanged: true, avatarChanged: true },
  ]);
});

test('buildAvatarSignature, formatNewEntriesLabel, and computeReconnectDelayMs', () => {
  assert.equal(
    buildAvatarSignature([
      { id: 'p2', user_id: 'u2', avatar_version: 'b' },
      { id: 'p3', user_id: null, avatar_version: null },
      { id: 'p1', user_id: 'u1', avatar_version: 'a' },
    ]),
    'u1:a|u2:b',
  );

  assert.equal(formatNewEntriesLabel(0), '');
  assert.equal(formatNewEntriesLabel(1), '1 nova atualização');
  assert.equal(formatNewEntriesLabel(3), '3 novas atualizações');

  assert.equal(computeReconnectDelayMs({ attempt: 0, baseMs: 1000, jitterRatio: 0 }), 1000);
  assert.equal(computeReconnectDelayMs({ attempt: 3, baseMs: 1000, maxMs: 5000, jitterRatio: 0 }), 5000);
  const withJitter = computeReconnectDelayMs({ attempt: 1, baseMs: 1000, jitterRatio: 0.2, random: () => 1 });
  assert.equal(withJitter, 2400);
});

test('createSseParser parses chunked events, comments, and CRLF line endings', () => {
  const parser = createSseParser();
  assert.deepEqual(parser.feed(': ping\n\nevent: syn'), []);
  const first = parser.feed('c\r\ndata: {"reason":"expense"}\r\n\r\n');
  assert.deepEqual(first, [
    { event: 'sync', id: null, data: '{"reason":"expense"}' },
  ]);
  const second = parser.feed('data: line1\ndata: line2\n\n');
  assert.deepEqual(second, [
    { event: 'message', id: null, data: 'line1\nline2' },
  ]);
});

test('createEventStreamHub enforces limits, evicts oldest user socket, and bumps event_activity on profile change', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  initSchema(db);
  const alice = createUser(db, { username: 'alice_sse', password: 'password123', name: 'Alice' });
  const event = createEvent(db, { title: 'Viagem', createdBy: alice.id, creatorName: alice.name });

  const messages = [];
  let closedOld = false;
  const hub = createEventStreamHub({
    maxConnections: 10,
    maxPerUser: 1,
    heartbeatIntervalMs: 0,
    getRssBytes: () => 50 * 1024 * 1024,
  });

  const s1 = hub.subscribe({
    eventId: event.id,
    userId: alice.id,
    write: (chunk) => messages.push({ slot: 1, chunk }),
    close: () => { closedOld = true; },
  });
  assert.equal(s1.ok, true);

  const s2 = hub.subscribe({
    eventId: event.id,
    userId: alice.id,
    write: (chunk) => messages.push({ slot: 2, chunk }),
  });
  assert.equal(s2.ok, true);
  assert.equal(closedOld, true);
  assert.equal(hub.stats().activeConnections, 1);

  const delivered = hub.notifyUserProfileChanged(db, alice.id, { reason: 'profile_avatar' });
  assert.equal(delivered, 1);
  assert.ok(messages.some((m) => m.slot === 2 && m.chunk.includes('"profile_avatar"')));

  const activity = db.prepare('SELECT updated_at FROM event_activity WHERE event_id = ?').get(event.id);
  assert.ok(activity?.updated_at);

  const highMemHub = createEventStreamHub({
    maxRssBytes: 10,
    heartbeatIntervalMs: 0,
    getRssBytes: () => 100,
  });
  assert.deepEqual(highMemHub.subscribe({ write: () => {} }), { ok: false, reason: 'high-memory' });

  hub.clear();
  db.close();
});

test('HTTP SSE /api/events/:id/stream pushes ready and sync frames on expense creation and avatar update', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  initSchema(db);
  setDb(db);
  eventStreamHub.clear();

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use('/api/auth', createAuthRouter());
  app.use('/api/events', eventRoutes);
  app.use('/api', expenseRoutes);

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}/api`;

  try {
    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'sseuser', password: 'password123', name: 'SSE User' }),
    });
    const { token, user } = await regRes.json();

    const evRes = await fetch(`${baseUrl}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: 'Festa' }),
    });
    const { event } = await evRes.json();

    const controller = new AbortController();
    const streamRes = await fetch(`${baseUrl}/events/${event.id}/stream`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    assert.equal(streamRes.status, 200);
    assert.match(streamRes.headers.get('content-type') || '', /text\/event-stream/);

    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    const parser = createSseParser();
    const received = [];

    const readUntilCount = async (targetCount) => {
      while (received.length < targetCount) {
        const { done, value } = await reader.read();
        if (done) break;
        received.push(...parser.feed(decoder.decode(value, { stream: true })));
      }
    };

    await readUntilCount(1);
    assert.equal(received[0].event, 'ready');

    await fetch(`${baseUrl}/events/${event.id}/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        description: 'Gelo',
        amount: 2000,
        payerId: event.creatorParticipant.id,
        splitMode: 'EQUAL_ALL',
      }),
    });

    await readUntilCount(2);
    assert.equal(received[1].event, 'sync');
    assert.equal(JSON.parse(received[1].data).reason, 'expense_created');

    // Also verify avatar update triggers SSE sync
    const fakeJpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/';
    await fetch(`${baseUrl}/auth/avatar`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ image: fakeJpeg }),
    });

    await readUntilCount(3);
    assert.equal(received[2].event, 'sync');
    assert.equal(JSON.parse(received[2].data).reason, 'profile_avatar');
    assert.equal(JSON.parse(received[2].data).userId, user.id);

    controller.abort();
  } finally {
    eventStreamHub.clear();
    server.close();
    db.close();
  }
});
