import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { getDb } from '../db/connection.js';
import {
  createUserAsync,
  authenticateUserAsync,
  createOrFindOAuthUser,
  findOAuthUser,
  getUserById,
  updateDisplayName,
  updatePasswordAsync,
} from '../db/users.js';
import { normalizeClientMode, recordActivityLog, touchUserLastSeen } from '../db/telemetry.js';
import { ConcurrencyLimitError, createConcurrencyGate } from '../domain/concurrencyGate.js';
import {
  GoogleAuthError,
  createGoogleJwksProvider,
  fetchGoogleAvatarDataUri,
  verifyGoogleIdToken,
} from '../domain/googleAuth.js';
import { presenceTracker } from '../domain/presence.js';
import { eventStreamHub } from '../domain/eventStreamHub.js';
import { requireAuth } from '../middleware/auth.js';
import { signSession } from '../domain/auth.js';
import { config } from '../config.js';

const defaultAuthGate = createConcurrencyGate();
const defaultGoogleKeyProvider = createGoogleJwksProvider();

function setSessionCookie(res, user, clientMode = null) {
  const sessionId = randomUUID();
  const nowMs = Date.now();
  const expiresAt = nowMs + 30 * 24 * 60 * 60 * 1000;
  const createdAt = new Date(nowMs).toISOString();
  const db = getDb();
  db.prepare('INSERT INTO sessions (id, user_id, expires_at, client_mode, created_at) VALUES (?, ?, ?, ?, ?)').run(
    sessionId,
    user.id,
    expiresAt,
    clientMode,
    createdAt,
  );
  const token = signSession({ userId: user.id, sessionId, expiresAt }, config.sessionSecret);
  res.cookie('divide_session', token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
  return token;
}

function sendAvatarResponse(req, res, avatar) {
  res.set('Vary', 'Cookie, Authorization');
  if (!avatar) {
    res.set('Cache-Control', 'private, no-store');
    return res.json({ avatar: null });
  }

  const etag = `"${avatar.version}"`;
  res.set('ETag', etag);

  const requestedVersion = typeof req.query?.v === 'string' ? req.query.v : null;
  if (requestedVersion && requestedVersion === avatar.version) {
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
  } else {
    res.set('Cache-Control', 'private, no-cache');
  }

  if (req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }

  return res.json({ avatar });
}

function handleOverloadOrError(res, err, fallbackStatus, fallbackMessage) {
  if (err instanceof ConcurrencyLimitError) {
    res.setHeader('Retry-After', '3');
    return res.status(503).json({ error: err.message });
  }
  return res.status(fallbackStatus).json({ error: err.message || fallbackMessage });
}

/**
 * Builds the authentication router with bounded non-blocking scrypt execution.
 */
export function createAuthRouter({
  authGate = defaultAuthGate,
  verifyGoogleToken = (credential, opts) => verifyGoogleIdToken(credential, {
    ...opts,
    getPublicKey: defaultGoogleKeyProvider,
  }),
  fetchGoogleAvatar = fetchGoogleAvatarDataUri,
  getGoogleClientId = () => config.googleClientId,
} = {}) {
  const router = Router();
  const runInGate = (task) => authGate.run(task);

  router.post('/register', async (req, res) => {
    try {
      const { username, password, name } = req.body || {};
      if (!username || !password || !name) {
        return res.status(400).json({ error: 'Preencha usuário, senha e nome' });
      }

      const db = getDb();
      const clientMode = normalizeClientMode(req.headers['x-client-mode']);
      const user = await createUserAsync(db, { username, password, name }, { runInGate });
      const token = setSessionCookie(res, user, clientMode);
      recordActivityLog(db, {
        eventType: 'user_registered',
        userId: user.id,
        metadata: clientMode ? { client_mode: clientMode } : null,
      });
      presenceTracker.record(user, { clientMode, route: '/auth/register' });

      res.status(201).json({
        user: getUserById(db, user.id),
        token,
      });
    } catch (err) {
      handleOverloadOrError(res, err, 400, 'Erro ao criar conta');
    }
  });

  router.post('/login', async (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ error: 'Informe usuário e senha' });
      }

      const db = getDb();
      const clientMode = normalizeClientMode(req.headers['x-client-mode']);
      const user = await authenticateUserAsync(db, username, password, { runInGate });
      if (!user) {
        recordActivityLog(db, {
          eventType: 'login_failed',
          metadata: { username: String(username).trim().toLowerCase().slice(0, 64) },
        });
        return res.status(401).json({ error: 'Usuário ou senha incorretos' });
      }

      touchUserLastSeen(db, user.id, null, Date.now(), 0);
      const token = setSessionCookie(res, user, clientMode);
      recordActivityLog(db, {
        eventType: 'login_success',
        userId: user.id,
        metadata: clientMode ? { client_mode: clientMode } : null,
      });
      presenceTracker.record(user, { clientMode, route: '/auth/login' });
      res.json({
        user: getUserById(db, user.id),
        token,
      });
    } catch (err) {
      handleOverloadOrError(res, err, 500, 'Erro ao realizar login');
    }
  });

  router.post('/google', async (req, res) => {
    const db = getDb();
    try {
      const { credential } = req.body || {};
      const clientId = typeof getGoogleClientId === 'function' ? getGoogleClientId() : getGoogleClientId;
      const identity = await verifyGoogleToken(credential, { clientId });

      const existingUser = findOAuthUser(db, 'google', identity.sub);
      const avatarImage = existingUser ? null : await fetchGoogleAvatar(identity.pictureUrl);

      const { user, isNewUser } = createOrFindOAuthUser(db, {
        provider: 'google',
        providerUserId: identity.sub,
        name: identity.name,
        avatarImage,
      });

      const clientMode = normalizeClientMode(req.headers['x-client-mode']);
      touchUserLastSeen(db, user.id, user.last_seen_at, Date.now(), 0);
      const token = setSessionCookie(res, user, clientMode);
      recordActivityLog(db, {
        eventType: isNewUser ? 'user_registered' : 'login_success',
        userId: user.id,
        metadata: { provider: 'google', ...(clientMode ? { client_mode: clientMode } : {}) },
      });
      presenceTracker.record(user, { clientMode, route: '/auth/google' });

      res.status(isNewUser ? 201 : 200).json({
        user,
        token,
        isNewUser,
      });
    } catch (err) {
      if (err instanceof GoogleAuthError) {
        if (err.status === 401) {
          recordActivityLog(db, {
            eventType: 'login_failed',
            metadata: { provider: 'google' },
          });
        }
        return res.status(err.status).json({ error: err.message });
      }
      handleOverloadOrError(res, err, 500, 'Erro ao entrar com Google');
    }
  });

  router.get('/me', (req, res) => {
    res.json({ user: req.user || null });
  });

  router.post('/ping', requireAuth, (_req, res) => {
    res.json({ ok: true });
  });

  router.post('/leave', requireAuth, (req, res) => {
    presenceTracker.remove(req.user.id);
    res.json({ ok: true });
  });

  router.get('/profile', requireAuth, (req, res) => {
    const db = getDb();
    const summary = db.prepare('SELECT COUNT(*) AS expense_count, COALESCE(SUM(amount), 0) AS total_expenses FROM expenses WHERE created_by = ?').get(req.user.id);
    res.json({ summary });
  });

  router.put('/profile', requireAuth, (req, res) => {
    try {
      const db = getDb();
      const user = updateDisplayName(db, req.user.id, req.body?.name);
      res.json({ user });
      eventStreamHub.notifyUserProfileChanged(db, req.user.id, { reason: 'profile_name' });
      eventStreamHub.publishToUsers([req.user.id], { reason: 'profile_name', userId: req.user.id });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/password', requireAuth, async (req, res) => {
    try {
      const db = getDb();
      await updatePasswordAsync(
        db,
        req.user.id,
        req.body?.currentPassword,
        req.body?.newPassword,
        req.sessionId,
        { runInGate },
      );
      recordActivityLog(db, { eventType: 'password_changed', userId: req.user.id });
      res.json({ ok: true });
    } catch (err) {
      handleOverloadOrError(res, err, 400, 'Erro ao alterar senha');
    }
  });

  router.get('/avatar', requireAuth, (req, res) => {
    const avatar = getDb().prepare('SELECT version, image FROM user_avatars WHERE user_id = ?').get(req.user.id);
    sendAvatarResponse(req, res, avatar || null);
  });

  router.get('/avatar/:userId', requireAuth, (req, res) => {
    const db = getDb();
    const allowed = req.params.userId === req.user.id
      || db.prepare('SELECT 1 FROM participants mine JOIN participants theirs ON theirs.event_id = mine.event_id WHERE mine.user_id = ? AND theirs.user_id = ? LIMIT 1').get(req.user.id, req.params.userId)
      || db.prepare('SELECT 1 FROM participants mine JOIN event_timeline_events tl ON tl.event_id = mine.event_id WHERE mine.user_id = ? AND tl.actor_user_id = ? LIMIT 1').get(req.user.id, req.params.userId);
    if (!allowed) return res.status(403).json({ error: 'Acesso restrito aos participantes do evento' });
    const avatar = db.prepare('SELECT version, image FROM user_avatars WHERE user_id = ?').get(req.params.userId);
    sendAvatarResponse(req, res, avatar || null);
  });

  router.put('/avatar', requireAuth, (req, res) => {
    const image = req.body?.image;
    if (typeof image !== 'string' || image.length > 120000 || !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(image)) return res.status(400).json({ error: 'Imagem inválida ou muito grande' });
    const db = getDb();
    const version = randomUUID();
    db.prepare('INSERT INTO user_avatars (user_id, version, image) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET version = excluded.version, image = excluded.image').run(req.user.id, version, image);
    recordActivityLog(db, { eventType: 'avatar_updated', userId: req.user.id });
    res.json({ user: getUserById(db, req.user.id) });
    eventStreamHub.notifyUserProfileChanged(db, req.user.id, { reason: 'profile_avatar' });
    eventStreamHub.publishToUsers([req.user.id], { reason: 'profile_avatar', userId: req.user.id });
  });

  router.post('/telemetry/pwa-installed', (req, res) => {
    const source = typeof req.body?.source === 'string' ? req.body.source.trim().slice(0, 40) : 'unknown';
    const clientMode = normalizeClientMode(req.headers['x-client-mode']);
    recordActivityLog(getDb(), {
      eventType: 'pwa_installed',
      userId: req.user?.id || null,
      metadata: { source, ...(clientMode ? { client_mode: clientMode } : {}) },
    });
    res.json({ ok: true });
  });

  router.post('/logout', (req, res) => {
    if (req.user?.id) presenceTracker.remove(req.user.id);
    if (req.sessionId) getDb().prepare('DELETE FROM sessions WHERE id = ?').run(req.sessionId);
    res.clearCookie('divide_session', { path: '/' });
    res.json({ ok: true });
  });

  return router;
}

export default createAuthRouter();
