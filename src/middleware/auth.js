import { verifySession } from '../domain/auth.js';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';
import { getUserById } from '../db/users.js';
import { normalizeClientMode, touchUserLastSeen } from '../db/telemetry.js';
import { presenceTracker } from '../domain/presence.js';

export function authMiddleware(req, res, next) {
  let token = req.cookies?.divide_session;

  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7);
  }

  if (!token) {
    req.user = null;
    return next();
  }

  const payload = verifySession(token, config.sessionSecret);
  if (!payload || !payload.userId || !payload.sessionId || !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= Date.now()) {
    req.user = null;
    return next();
  }

  const db = getDb();
  const session = db.prepare('SELECT id, client_mode FROM sessions WHERE id = ? AND user_id = ? AND expires_at > ?').get(payload.sessionId, payload.userId, Date.now());
  if (!session) { req.user = null; return next(); }
  req.sessionId = payload.sessionId;
  const user = getUserById(db, payload.userId);
  if (!user) {
    req.user = null;
    return next();
  }

  touchUserLastSeen(db, user.id, user.last_seen_at);
  const clientMode = normalizeClientMode(req.headers['x-client-mode']);
  if (clientMode && session.client_mode !== clientMode) {
    try {
      db.prepare('UPDATE sessions SET client_mode = ? WHERE id = ?').run(clientMode, session.id);
    } catch {
      // Non-critical session telemetry update
    }
  }

  req.user = {
    id: user.id,
    username: user.username,
    name: user.name,
    avatar_version: user.avatar_version,
    has_password: user.has_password,
  };
  if (!/\/api\/auth\/leave$/.test(req.path)) {
    presenceTracker.record(req.user, {
      clientMode: clientMode || session.client_mode || null,
      route: req.path,
    });
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Você precisa estar logado para acessar este recurso' });
  }
  next();
}

export function isEventMember(db, eventId, userId) {
  return !!db.prepare('SELECT 1 FROM participants WHERE event_id = ? AND user_id = ?').get(eventId, userId);
}

export function requireEventMember(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Faça login para continuar' });
  if (!isEventMember(getDb(), req.params.id, req.user.id)) return res.status(403).json({ error: 'Acesso restrito aos participantes do evento' });
  next();
}
