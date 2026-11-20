import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { initSchema } from '../src/db/schema.js';
import {
  normalizeClientMode,
  pruneOldActivityLogs,
  recordActivityLog,
  touchUserLastSeen,
} from '../src/db/telemetry.js';
import { createUser } from '../src/db/users.js';
import { createEvent } from '../src/db/events.js';
import { addParticipant, claimParticipant } from '../src/db/participants.js';
import { createExpense } from '../src/db/expenses.js';
import { createSettlement } from '../src/db/settlements.js';
import { getDashboardMetrics } from '../src/domain/analytics.js';
import { createPresenceTracker } from '../src/domain/presence.js';
import { createDashboardApp } from '../src/dashboard/app.js';

test('normalizeClientMode accepts only pwa or browser', () => {
  assert.equal(normalizeClientMode('pwa'), 'pwa');
  assert.equal(normalizeClientMode(' BROWSER '), 'browser');
  assert.equal(normalizeClientMode('electron'), null);
  assert.equal(normalizeClientMode(null), null);
});

test('initSchema safely migrates legacy tables missing telemetry columns', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE user_avatars (user_id TEXT PRIMARY KEY, version TEXT NOT NULL, image TEXT NOT NULL);
    CREATE TABLE events (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, title TEXT NOT NULL, description TEXT, created_by TEXT, created_at TEXT NOT NULL);
    CREATE TABLE participants (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, user_id TEXT, name TEXT NOT NULL, color TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE expenses (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, description TEXT NOT NULL, amount INTEGER NOT NULL, payer_id TEXT NOT NULL, split_mode TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL);
    CREATE TABLE expense_splits (id TEXT PRIMARY KEY, expense_id TEXT NOT NULL, participant_id TEXT NOT NULL, allocated_amount INTEGER, percentage REAL);
    CREATE TABLE settlements (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, from_participant_id TEXT NOT NULL, to_participant_id TEXT NOT NULL, amount INTEGER NOT NULL, notes TEXT, created_at TEXT NOT NULL);
  `);

  initSchema(db);

  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  const sessionCols = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  const participantCols = db.prepare('PRAGMA table_info(participants)').all().map((c) => c.name);
  const settlementCols = db.prepare('PRAGMA table_info(settlements)').all().map((c) => c.name);
  const logsTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'activity_logs'").get();

  assert.ok(userCols.includes('last_seen_at'));
  assert.ok(sessionCols.includes('client_mode'));
  assert.ok(sessionCols.includes('created_at'));
  assert.ok(participantCols.includes('join_source'));
  assert.ok(settlementCols.includes('created_by'));
  assert.ok(logsTable);
});

test('touchUserLastSeen throttles updates within interval and pruneOldActivityLogs respects retention', () => {
  const db = new DatabaseSync(':memory:');
  initSchema(db);
  const user = createUser(db, { username: 'throttled', password: 'secret123', name: 'Throttled' });
  const baseMs = Date.parse('2026-11-12T12:00:00.000Z');

  // Within 6h interval -> skipped
  assert.equal(touchUserLastSeen(db, user.id, new Date(baseMs - 60_000).toISOString(), baseMs), false);
  // Past 6h interval -> updated
  assert.equal(touchUserLastSeen(db, user.id, new Date(baseMs - 7 * 3600_000).toISOString(), baseMs), true);
  const updated = db.prepare('SELECT last_seen_at FROM users WHERE id = ?').get(user.id);
  assert.equal(updated.last_seen_at, new Date(baseMs).toISOString());

  // Logs retention
  recordActivityLog(db, {
    eventType: 'login_success',
    userId: user.id,
    createdAt: new Date(baseMs - 100 * 86400_000).toISOString(),
  });
  recordActivityLog(db, {
    eventType: 'login_success',
    userId: user.id,
    createdAt: new Date(baseMs - 2 * 86400_000).toISOString(),
  });
  assert.equal(pruneOldActivityLogs(db, 90, baseMs), 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM activity_logs').get().count, 1);
});

test('getDashboardMetrics aggregates users, sessions, funnel, splits, and logs', () => {
  const db = new DatabaseSync(':memory:');
  initSchema(db);
  const now = new Date('2026-11-12T20:00:00.000Z');

  const alice = createUser(db, { username: 'alice', password: 'secret123', name: 'Alice' });
  const bob = createUser(db, { username: 'bob', password: 'secret123', name: 'Bob' });
  db.prepare('INSERT INTO sessions (id, user_id, expires_at, client_mode, created_at) VALUES (?, ?, ?, ?, ?)').run(
    's1', alice.id, now.getTime() + 86400_000, 'pwa', now.toISOString(),
  );
  db.prepare('INSERT INTO sessions (id, user_id, expires_at, client_mode, created_at) VALUES (?, ?, ?, ?, ?)').run(
    's2', bob.id, now.getTime() + 86400_000, 'browser', now.toISOString(),
  );

  const ev1 = createEvent(db, { title: 'Churrasco', createdBy: alice.id, creatorName: alice.name });
  const ev2 = createEvent(db, { title: 'Praia', createdBy: alice.id, creatorName: alice.name });
  const placeholder = addParticipant(db, { eventId: ev1.id, name: 'Convidado', joinSource: 'placeholder' });
  claimParticipant(db, { participantId: placeholder.id, userId: bob.id, userName: bob.name });
  addParticipant(db, { eventId: ev1.id, name: 'Carlos', joinSource: 'placeholder' });
  addParticipant(db, { eventId: ev2.id, userId: bob.id, name: bob.name, joinSource: 'join' });

  createExpense(db, {
    eventId: ev1.id,
    description: 'Carne',
    amount: 12000,
    payerId: ev1.creatorParticipant.id,
    splitMode: 'EQUAL_ALL',
    createdBy: alice.id,
  });
  createExpense(db, {
    eventId: ev1.id,
    description: 'Bebidas',
    amount: 6000,
    payerId: placeholder.id,
    splitMode: 'SHARES',
    splits: [
      { participant_id: ev1.creatorParticipant.id, shares: 2 },
      { participant_id: placeholder.id, shares: 1 },
    ],
    createdBy: bob.id,
  });
  createSettlement(db, {
    eventId: ev1.id,
    fromParticipantId: placeholder.id,
    toParticipantId: ev1.creatorParticipant.id,
    amount: 3000,
    notes: 'Pix',
    createdBy: bob.id,
  });

  recordActivityLog(db, { eventType: 'login_failed', metadata: { username: 'eve' }, createdAt: now.toISOString() });
  recordActivityLog(db, { eventType: 'pwa_installed', userId: alice.id, metadata: { source: 'appinstalled' }, createdAt: now.toISOString() });

  const metrics = getDashboardMetrics(db, { days: 7, now });

  assert.equal(metrics.users.total, 2);
  assert.equal(metrics.users.returningMultiEvent, 2);
  assert.equal(metrics.sessions.activeTotal, 2);
  assert.equal(metrics.sessions.pwa, 1);
  assert.equal(metrics.sessions.browser, 1);
  assert.equal(metrics.events.total, 2);
  assert.equal(metrics.events.withSettlements, 1);
  assert.equal(metrics.participants.linked, 4);
  assert.equal(metrics.participants.unclaimed, 1);
  assert.equal(metrics.participants.byJoinSource.creator, 2);
  assert.equal(metrics.participants.byJoinSource.claim, 1);
  assert.equal(metrics.participants.byJoinSource.join, 1);
  assert.equal(metrics.participants.byJoinSource.placeholder, 1);
  assert.equal(metrics.expenses.total, 2);
  assert.equal(metrics.expenses.totalAmountCents, 18000);
  assert.equal(metrics.expenses.bySplitMode.EQUAL_ALL, 1);
  assert.equal(metrics.expenses.bySplitMode.SHARES, 1);
  assert.equal(metrics.settlements.total, 1);
  assert.equal(metrics.settlements.withNotes, 1);
  assert.equal(metrics.dailySeries.length, 7);
  assert.equal(metrics.logCountsInPeriod.login_failed, 1);
  assert.equal(metrics.logCountsInPeriod.pwa_installed, 1);
});

test('Dashboard server serves metrics and HTML over read-only WAL SQLite file', async (t) => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'divide-dash-'));
  const dbPath = path.join(tempDir, 'stage.sqlite');
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));

  const rwDb = new DatabaseSync(dbPath);
  rwDb.exec('PRAGMA journal_mode = WAL;');
  initSchema(rwDb);
  const user = createUser(rwDb, { username: 'stage', password: 'secret123', name: 'Stage User' });
  recordActivityLog(rwDb, { eventType: 'login_failed', metadata: { username: 'bad' } });
  rwDb.close();

  const app = createDashboardApp({ dbPath, environmentLabel: 'staging', port: 3003, presenceUrl: null });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const healthRes = await fetch(`${baseUrl}/health`);
  assert.equal(healthRes.status, 200);
  const health = await healthRes.json();
  assert.equal(health.readOnly, true);
  assert.equal(health.dbExists, true);

  const metricsRes = await fetch(`${baseUrl}/api/metrics?days=14&logType=login_failed`);
  assert.equal(metricsRes.status, 200);
  const metrics = await metricsRes.json();
  assert.equal(metrics.users.total, 1);
  assert.equal(metrics.recentLogs.length, 1);
  assert.equal(metrics.recentLogs[0].eventType, 'login_failed');

  const htmlRes = await fetch(`${baseUrl}/`);
  assert.equal(htmlRes.status, 200);
  const html = await htmlRes.text();
  assert.ok(html.includes('DiviDinDin!'));
  assert.ok(html.includes('staging'));
  assert.ok(html.includes('100dvh'));
  assert.ok(html.includes('mobile-dock'));
});

test('Presence tracker handles throttling, TTL pruning, immediate removal, and circuit breaker fallback with cooldown', () => {
  let rss = 60 * 1024 * 1024;
  const tracker = createPresenceTracker({
    ttlMs: 5 * 60_000,
    maxUsers: 2,
    userThrottleMs: 15_000,
    cooldownMs: 5 * 60_000,
    maxRssBytes: 200 * 1024 * 1024,
    getRssBytes: () => rss,
  });

  const t0 = 1_000_000;
  assert.equal(tracker.record({ id: 'u1', username: 'ana', name: 'Ana' }, { clientMode: 'pwa', nowMs: t0 }).recorded, true);
  // Same user within 15s throttle -> skipped
  assert.equal(tracker.record({ id: 'u1', username: 'ana', name: 'Ana' }, { clientMode: 'pwa', nowMs: t0 + 5_000 }).throttled, true);
  assert.equal(tracker.record({ id: 'u2', username: 'bob', name: 'Bob' }, { clientMode: 'browser', nowMs: t0 + 10_000 }).recorded, true);

  const snap1 = tracker.snapshot({ nowMs: t0 + 12_000 });
  assert.equal(snap1.degraded, false);
  assert.equal(snap1.ttlMinutes, 5);
  assert.equal(snap1.count, 2);
  assert.equal(snap1.pwaCount, 1);
  assert.equal(snap1.browserCount, 1);
  assert.equal(snap1.users[0].userId, 'u2');

  // Immediate leave removes user before 5m TTL expires
  assert.equal(tracker.remove('u2'), true);
  assert.equal(tracker.remove('u2'), false);
  const snapAfterLeave = tracker.snapshot({ nowMs: t0 + 13_000 });
  assert.equal(snapAfterLeave.count, 1);
  assert.equal(snapAfterLeave.users[0].userId, 'u1');

  // Restore u2 so concurrency limit test still hits maxUsers=2
  assert.equal(tracker.record({ id: 'u2', username: 'bob', name: 'Bob' }, { clientMode: 'browser', nowMs: t0 + 14_000 }).recorded, true);

  // Adding 3rd concurrent user exceeds maxUsers=2 -> trips high-concurrency breaker
  const tripped = tracker.record({ id: 'u3', username: 'carol', name: 'Carol' }, { nowMs: t0 + 20_000 });
  assert.equal(tripped.degraded, true);
  assert.equal(tripped.reason, 'high-concurrency');
  assert.equal(tracker.snapshot({ nowMs: t0 + 30_000 }).degraded, true);

  // Recovers after 5 min cooldown
  const recovered = tracker.record({ id: 'u3', username: 'carol', name: 'Carol' }, { nowMs: t0 + 20_000 + 5 * 60_000 + 1 });
  assert.equal(recovered.recorded, true);
  assert.equal(recovered.degraded, false);

  // Memory pressure trips high-memory breaker
  rss = 205 * 1024 * 1024;
  const memSnap = tracker.snapshot({ nowMs: t0 + 20_000 + 5 * 60_000 + 10 });
  assert.equal(memSnap.degraded, true);
  assert.equal(memSnap.reason, 'high-memory');
});

test('Dashboard switches seamlessly between Option B live presence and Option A SQL fallback', async (t) => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'divide-pres-'));
  const dbPath = path.join(tempDir, 'prod.sqlite');
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));

  const rwDb = new DatabaseSync(dbPath);
  rwDb.exec('PRAGMA journal_mode = WAL;');
  initSchema(rwDb);
  const user = createUser(rwDb, { username: 'felipe', password: 'secret123', name: 'Felipe' });
  recordActivityLog(rwDb, { eventType: 'expense_created', userId: user.id });
  rwDb.close();

  let mode = 'live';
  const app = createDashboardApp({
    dbPath,
    environmentLabel: 'production',
    cacheTtlMs: 0,
    presenceUrl: 'http://127.0.0.1:3001/internal/presence',
    presenceFetcher: async () => {
      if (mode === 'live') {
        return {
          degraded: false,
          maxUsers: 2000,
          ttlMinutes: 5,
          rssMb: 55.2,
          count: 1,
          pwaCount: 1,
          browserCount: 0,
          users: [{ userId: user.id, username: 'felipe', name: 'Felipe', clientMode: 'pwa', lastActiveAt: new Date().toISOString() }],
        };
      }
      if (mode === 'degraded') {
        return { degraded: true, reason: 'high-concurrency', maxUsers: 2000, rssMb: 90 };
      }
      throw new Error('timeout');
    },
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Option B live
  let data = await (await fetch(`${baseUrl}/api/metrics`)).json();
  assert.equal(data.presence.source, 'memory-ttl');
  assert.equal(data.presence.degraded, false);
  assert.equal(data.presence.count, 1);
  assert.equal(data.presence.pwaCount, 1);

  // Degraded -> falls back to Option A (SQLite activity_logs)
  mode = 'degraded';
  data = await (await fetch(`${baseUrl}/api/metrics`)).json();
  assert.equal(data.presence.source, 'fallback-sql');
  assert.equal(data.presence.degraded, true);
  assert.equal(data.presence.reason, 'high-concurrency');
  assert.equal(data.presence.count, 1);
  assert.equal(data.presence.users[0].username, 'felipe');

  // Timeout/error -> falls back to Option A
  mode = 'error';
  data = await (await fetch(`${baseUrl}/api/metrics`)).json();
  assert.equal(data.presence.source, 'fallback-sql');
  assert.equal(data.presence.degraded, true);
  assert.equal(data.presence.reason, 'api-timeout-or-unreachable');
});
