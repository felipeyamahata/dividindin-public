import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { getDb, setDb } from '../src/db/connection.js';
import { initSchema } from '../src/db/schema.js';
import { runMaintenanceSweep, startMaintenanceScheduler } from '../src/db/maintenance.js';
import { recordActivityLog } from '../src/db/telemetry.js';
import {
  createUser,
  createUserAsync,
  authenticateUserAsync,
  updatePasswordAsync,
} from '../src/db/users.js';
import {
  hashPassword,
  hashPasswordAsync,
  verifyPassword,
  verifyPasswordAsync,
} from '../src/domain/auth.js';
import {
  ConcurrencyLimitError,
  createConcurrencyGate,
} from '../src/domain/concurrencyGate.js';
import {
  DEFAULT_MAX_RSS_BYTES,
  DEFAULT_PRESENCE_TTL_MS,
  createPresenceTracker,
  presenceTracker,
} from '../src/domain/presence.js';
import { createLoadSheddingMiddleware } from '../src/middleware/loadShedding.js';
import { authMiddleware } from '../src/middleware/auth.js';
import { createAuthRouter } from '../src/routes/auth.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('createConcurrencyGate enforces maxConcurrent, queue cap, and queue timeout', async () => {
  const gate = createConcurrencyGate({ maxConcurrent: 2, maxQueueSize: 1, queueTimeoutMs: 60 });

  let running = 0;
  let peakRunning = 0;
  let releaseFirst;
  const firstHold = new Promise((resolve) => { releaseFirst = resolve; });

  const trackedTask = (hold) => gate.run(async () => {
    running += 1;
    peakRunning = Math.max(peakRunning, running);
    await hold;
    running -= 1;
    return 'ok';
  });

  const p1 = trackedTask(firstHold);
  const p2 = trackedTask(firstHold);
  // 3rd enters queue (queue size = 1)
  const p3 = gate.run(async () => 'queued-ok');
  // 4th exceeds maxQueueSize -> rejected immediately
  await assert.rejects(
    () => gate.run(async () => 'overflow'),
    (err) => err instanceof ConcurrencyLimitError && err.code === 'QUEUE_FULL' && err.status === 503,
  );

  assert.equal(peakRunning, 2);
  assert.equal(gate.stats().active, 2);
  assert.equal(gate.stats().queued, 1);

  // Keep the test process alive while the gate's unref'ed timeout is pending.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(
      () => p3,
      (err) => err instanceof ConcurrencyLimitError && err.code === 'QUEUE_TIMEOUT' && err.status === 503,
    );
  } finally {
    clearTimeout(keepAlive);
  }

  releaseFirst();
  assert.deepEqual(await Promise.all([p1, p2]), ['ok', 'ok']);
  assert.equal(gate.stats().active, 0);
  assert.equal(gate.stats().queued, 0);
});

test('Async scrypt helpers are compatible with sync hashes and DB async user flows', async () => {
  const pwd = 'festival-rock-mountain-2026';
  const asyncHash = await hashPasswordAsync(pwd);
  const syncHash = hashPassword(pwd);

  assert.equal(verifyPassword(pwd, asyncHash), true);
  assert.equal(await verifyPasswordAsync(pwd, syncHash), true);
  assert.equal(await verifyPasswordAsync('wrong-password', asyncHash), false);

  const db = new DatabaseSync(':memory:');
  initSchema(db);
  const gate = createConcurrencyGate({ maxConcurrent: 2, maxQueueSize: 10, queueTimeoutMs: 2000 });
  const runInGate = (fn) => gate.run(fn);

  const created = await createUserAsync(db, {
    username: 'itaipava',
    password: pwd,
    name: 'Itaipava User',
  }, { runInGate });
  assert.ok(created.id.startsWith('usr_'));

  const authed = await authenticateUserAsync(db, 'itaipava', pwd, { runInGate });
  assert.equal(authed.id, created.id);
  assert.equal(await authenticateUserAsync(db, 'itaipava', 'nope', { runInGate }), null);

  await updatePasswordAsync(db, created.id, pwd, 'nova-senha-123', 'sess_keep', { runInGate });
  assert.equal(await authenticateUserAsync(db, 'itaipava', 'nova-senha-123', { runInGate }) !== null, true);

  // Concurrent duplicate registration rejects cleanly
  const results = await Promise.allSettled([
    createUserAsync(db, { username: 'duplicado', password: pwd, name: 'Um' }, { runInGate }),
    createUserAsync(db, { username: 'duplicado', password: pwd, name: 'Dois' }, { runInGate }),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason.message, /já está em uso/i);
});

test('SQLite connection pragmas, new indexes, and maintenance sweep work cleanly', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'divide-resilience-'));
  const dbPath = path.join(dir, 'test.sqlite');
  try {
    setDb(null);
    const db = getDb(dbPath);
    const busyTimeout = db.prepare('PRAGMA busy_timeout;').get().timeout;
    const journalMode = db.prepare('PRAGMA journal_mode;').get().journal_mode;
    const synchronous = db.prepare('PRAGMA synchronous;').get().synchronous;

    assert.equal(busyTimeout, 3000);
    assert.equal(String(journalMode).toLowerCase(), 'wal');
    assert.equal(synchronous, 1); // NORMAL

    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name);
    assert.ok(indexes.includes('idx_participants_user'));
    assert.ok(indexes.includes('idx_sessions_expires'));
    assert.ok(indexes.includes('idx_sessions_user'));

    const user = createUser(db, { username: 'sweep', password: 'password123', name: 'Sweep' });
    const nowMs = Date.UTC(2026, 10, 12, 12, 0, 0);
    db.prepare('INSERT INTO sessions (id, user_id, expires_at, client_mode, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('sess_expired', user.id, nowMs - 1000, 'browser', new Date(nowMs - 5000).toISOString());
    db.prepare('INSERT INTO sessions (id, user_id, expires_at, client_mode, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('sess_active', user.id, nowMs + 60_000, 'pwa', new Date(nowMs).toISOString());

    recordActivityLog(db, {
      eventType: 'login_success',
      userId: user.id,
      createdAt: new Date(nowMs - 95 * 24 * 60 * 60 * 1000).toISOString(),
    });
    recordActivityLog(db, {
      eventType: 'login_success',
      userId: user.id,
      createdAt: new Date(nowMs - 2 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const summary = runMaintenanceSweep(db, { retentionDays: 90, nowMs });
    assert.equal(summary.expiredSessionsDeleted, 1);
    assert.equal(summary.prunedActivityLogs, 1);

    const remainingSessions = db.prepare('SELECT id FROM sessions').all().map((r) => r.id);
    assert.deepEqual(remainingSessions, ['sess_active']);

    const stopScheduler = startMaintenanceScheduler(() => db, { intervalMs: 60_000, runInitial: true });
    stopScheduler();
    db.close();
  } finally {
    setDb(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Load shedding returns 503 with Retry-After on high RSS or event-loop lag and exempts health', async (t) => {
  let rssBytes = 120 * 1024 * 1024;
  let lagMs = 10;

  const app = express();
  const shed = createLoadSheddingMiddleware({
    maxRssBytes: 340 * 1024 * 1024,
    maxEventLoopLagMs: 250,
    retryAfterSeconds: 5,
    getRssBytes: () => rssBytes,
    getEventLoopLagMs: () => lagMs,
  });
  app.use(shed);
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/api/ping', (req, res) => res.json({ pong: true }));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => {
    shed.stop();
    server.close();
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${baseUrl}/api/ping`)).status, 200);

  // High RSS triggers 503 on API, but /health stays 200
  rssBytes = 345 * 1024 * 1024;
  const rssBlocked = await fetch(`${baseUrl}/api/ping`);
  assert.equal(rssBlocked.status, 503);
  assert.equal(rssBlocked.headers.get('retry-after'), '5');
  assert.equal((await fetch(`${baseUrl}/health`)).status, 200);

  // Recover RSS, spike event loop lag
  rssBytes = 150 * 1024 * 1024;
  lagMs = 300;
  const lagBlocked = await fetch(`${baseUrl}/api/ping`);
  assert.equal(lagBlocked.status, 503);

  lagMs = 15;
  assert.equal((await fetch(`${baseUrl}/api/ping`)).status, 200);
});

test('Auth router returns 503 when scrypt gate saturates and serves ETag/immutable avatar caching', async (t) => {
  const testDb = new DatabaseSync(':memory:');
  initSchema(testDb);
  setDb(testDb);

  const gate = createConcurrencyGate({ maxConcurrent: 1, maxQueueSize: 0, queueTimeoutMs: 500 });
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use('/api/auth', createAuthRouter({ authGate: gate }));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => {
    setDb(null);
    server.close();
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;

  // Register a user cleanly
  const regRes = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'rocker', password: 'password123', name: 'Rocker' }),
  });
  assert.equal(regRes.status, 201);
  const cookie = regRes.headers.get('set-cookie');
  const { user } = await regRes.json();

  // Upload avatar and test ETag + 304 + immutable query version
  const putAvatar = await fetch(`${baseUrl}/avatar`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ image: 'data:image/jpeg;base64,/9j/AAAA' }),
  });
  assert.equal(putAvatar.status, 200);
  const version = (await putAvatar.json()).user.avatar_version;
  assert.ok(version);

  const firstGet = await fetch(`${baseUrl}/avatar/${user.id}`, { headers: { Cookie: cookie } });
  assert.equal(firstGet.status, 200);
  assert.equal(firstGet.headers.get('etag'), `"${version}"`);
  assert.equal(firstGet.headers.get('cache-control'), 'private, no-cache');

  const notModified = await fetch(`${baseUrl}/avatar/${user.id}`, {
    headers: { Cookie: cookie, 'If-None-Match': `"${version}"` },
  });
  assert.equal(notModified.status, 304);

  const immutableGet = await fetch(`${baseUrl}/avatar/${user.id}?v=${encodeURIComponent(version)}`, {
    headers: { Cookie: cookie },
  });
  assert.equal(immutableGet.status, 200);
  assert.equal(immutableGet.headers.get('cache-control'), 'private, max-age=31536000, immutable');

  // Saturate the 1-slot authGate manually and verify concurrent /login returns 503 Retry-After
  let releaseGate;
  const holding = gate.run(() => new Promise((resolve) => { releaseGate = resolve; }));
  await delay(10);

  const overloadedLogin = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'rocker', password: 'password123' }),
  });
  assert.equal(overloadedLogin.status, 503);
  assert.equal(overloadedLogin.headers.get('retry-after'), '3');

  releaseGate();
  await holding;
});

test('Presence tracker defaults to 5m TTL and 320 MB RSS threshold for 384 MB ceiling', () => {
  assert.equal(DEFAULT_PRESENCE_TTL_MS, 5 * 60 * 1000);
  assert.equal(DEFAULT_MAX_RSS_BYTES, 320 * 1024 * 1024);
  let rss = 250 * 1024 * 1024;
  const tracker = createPresenceTracker({ getRssBytes: () => rss });
  assert.equal(tracker.record({ id: 'u1', username: 'ana', name: 'Ana' }).recorded, true);
  assert.equal(tracker.snapshot().ttlMinutes, 5);
  assert.equal(tracker.snapshot().degraded, false);

  rss = 325 * 1024 * 1024;
  assert.equal(tracker.snapshot().degraded, true);
  assert.equal(tracker.snapshot().reason, 'high-memory');
});

test('HTTP /api/auth/ping and /api/auth/leave immediately update live presence tracker', async (t) => {
  const db = new DatabaseSync(':memory:');
  initSchema(db);
  setDb(db);
  presenceTracker.clear();

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use('/api/auth', createAuthRouter());

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => {
    presenceTracker.clear();
    setDb(null);
    server.close();
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;

  // Reject unauthenticated calls
  assert.equal((await fetch(`${baseUrl}/ping`, { method: 'POST' })).status, 401);
  assert.equal((await fetch(`${baseUrl}/leave`, { method: 'POST' })).status, 401);

  const regRes = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-Mode': 'pwa' },
    body: JSON.stringify({ username: 'fastpresence', password: 'password123', name: 'Fast Presence' }),
  });
  assert.equal(regRes.status, 201);
  const { token, user } = await regRes.json();
  assert.equal(presenceTracker.snapshot().count, 1);

  // Explicit leave removes user immediately
  const leaveRes = await fetch(`${baseUrl}/leave`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'X-Client-Mode': 'pwa' },
  });
  assert.equal(leaveRes.status, 200);
  assert.equal(presenceTracker.snapshot().count, 0);

  // Explicit ping immediately restores user with clientMode
  const pingRes = await fetch(`${baseUrl}/ping`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'X-Client-Mode': 'pwa' },
  });
  assert.equal(pingRes.status, 200);
  const snap = presenceTracker.snapshot();
  assert.equal(snap.count, 1);
  assert.equal(snap.pwaCount, 1);
  assert.equal(snap.users[0].userId, user.id);

  // Logout also clears presence
  const logoutRes = await fetch(`${baseUrl}/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(logoutRes.status, 200);
  assert.equal(presenceTracker.snapshot().count, 0);
});
