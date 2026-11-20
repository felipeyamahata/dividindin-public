import { randomBytes, randomUUID } from 'node:crypto';
import {
  hashPassword,
  hashPasswordAsync,
  verifyPassword,
  verifyPasswordAsync,
} from '../domain/auth.js';
import { buildCandidateUsername } from '../domain/googleAuth.js';

const OAUTH_NO_PASSWORD_SENTINEL = '!oauth-no-password';

/**
 * Returns true when a stored password hash represents an active scrypt password rather than an OAuth sentinel.
 */
export function hasLocalPassword(passwordHash) {
  return typeof passwordHash === 'string' && passwordHash.length > 0 && !passwordHash.startsWith('!');
}

function prepareUserCreation(db, { username, password, name }) {
  if (
    typeof username !== 'string'
    || typeof name !== 'string'
    || typeof password !== 'string'
    || username.length > 64
    || name.length > 100
    || password.length < 8
    || password.length > 256
  ) {
    throw new Error('Usuário, nome ou senha inválidos; a senha deve ter entre 8 e 256 caracteres');
  }
  const trimmedUser = username.trim().toLowerCase();
  const trimmedName = name.trim();
  if (!trimmedUser || !password || !trimmedName) {
    throw new Error('Usuário, senha e nome são obrigatórios');
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(trimmedUser);
  if (existing) {
    throw new Error('Nome de usuário já está em uso');
  }

  return { trimmedUser, trimmedName };
}

function insertUserRecord(db, { trimmedUser, trimmedName, passwordHash }) {
  const id = `usr_${randomUUID()}`;
  const now = new Date().toISOString();

  try {
    db.prepare(`
      INSERT INTO users (id, username, password_hash, name, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, trimmedUser, passwordHash, trimmedName, now, now);
  } catch (err) {
    if (String(err?.message || '').includes('UNIQUE')) {
      throw new Error('Nome de usuário já está em uso');
    }
    throw err;
  }

  return { id, username: trimmedUser, name: trimmedName, created_at: now, last_seen_at: now };
}

export function createUser(db, { username, password, name }) {
  const prepared = prepareUserCreation(db, { username, password, name });
  const passwordHash = hashPassword(password);
  return insertUserRecord(db, { ...prepared, passwordHash });
}

/**
 * Creates a user using non-blocking password hashing, optionally throttled by a concurrency gate.
 */
export async function createUserAsync(db, { username, password, name }, { runInGate = fn => fn() } = {}) {
  const prepared = prepareUserCreation(db, { username, password, name });
  const passwordHash = await runInGate(() => hashPasswordAsync(password));
  return insertUserRecord(db, { ...prepared, passwordHash });
}

export function getUserById(db, id) {
  const row = db.prepare(`
    SELECT u.id, u.username, u.name, u.created_at, u.last_seen_at, u.password_hash, a.version AS avatar_version
    FROM users u
    LEFT JOIN user_avatars a ON a.user_id = u.id
    WHERE u.id = ?
  `).get(id);
  if (!row) return undefined;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
    avatar_version: row.avatar_version,
    has_password: hasLocalPassword(row.password_hash),
  };
}

export function findOAuthUser(db, provider, providerUserId) {
  if (typeof provider !== 'string' || typeof providerUserId !== 'string' || !provider || !providerUserId) {
    return null;
  }
  const row = db.prepare(`
    SELECT u.id
    FROM user_oauth_accounts oa
    JOIN users u ON u.id = oa.user_id
    WHERE oa.provider = ? AND oa.provider_user_id = ?
  `).get(provider, providerUserId);
  return row ? getUserById(db, row.id) : null;
}

function allocateUniqueUsername(db, displayName) {
  const base = buildCandidateUsername(displayName);
  const existsStmt = db.prepare('SELECT 1 FROM users WHERE username = ?');
  if (!existsStmt.get(base)) return base;

  for (let attempt = 0; attempt < 12; attempt++) {
    const suffix = randomBytes(2).toString('hex');
    const candidate = `${base.slice(0, 59)}_${suffix}`;
    if (!existsStmt.get(candidate)) return candidate;
  }
  return `usr_${randomBytes(6).toString('hex')}`;
}

/**
 * Resolves or atomically creates a local user and linked OAuth identity without storing personal emails.
 * Optional `avatarImage` is seeded only on initial user creation so later in-app edits are preserved.
 */
export function createOrFindOAuthUser(db, {
  provider,
  providerUserId,
  name,
  avatarImage = null,
}) {
  const existing = findOAuthUser(db, provider, providerUserId);
  if (existing) {
    return { user: existing, isNewUser: false };
  }

  const cleanName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 100) : 'Usuário';
  const id = `usr_${randomUUID()}`;
  const oauthId = `oa_${randomUUID()}`;
  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    const existingInsideTx = findOAuthUser(db, provider, providerUserId);
    if (existingInsideTx) {
      db.exec('ROLLBACK');
      return { user: existingInsideTx, isNewUser: false };
    }

    const username = allocateUniqueUsername(db, cleanName);
    db.prepare(`
      INSERT INTO users (id, username, password_hash, name, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, username, OAUTH_NO_PASSWORD_SENTINEL, cleanName, now, now);

    db.prepare(`
      INSERT INTO user_oauth_accounts (id, user_id, provider, provider_user_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(oauthId, id, provider, providerUserId, now);

    if (typeof avatarImage === 'string' && avatarImage.startsWith('data:image/jpeg;base64,')) {
      db.prepare(`
        INSERT INTO user_avatars (user_id, version, image)
        VALUES (?, ?, ?)
      `).run(id, randomUUID(), avatarImage);
    }

    db.exec('COMMIT');
    return { user: getUserById(db, id), isNewUser: true };
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback failure when transaction is already closed
    }
    const raced = findOAuthUser(db, provider, providerUserId);
    if (raced) {
      return { user: raced, isNewUser: false };
    }
    throw err;
  }
}

export function updateDisplayName(db, id, name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) throw new Error('Informe um nome com até 100 caracteres');
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim(), id);
  db.prepare('UPDATE participants SET name = ? WHERE user_id = ?').run(name.trim(), id);
  return getUserById(db, id);
}

function preparePasswordUpdate(db, id, currentPassword, newPassword) {
  if (typeof currentPassword !== 'string' || currentPassword.length > 256 || typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 256) {
    throw new Error('A nova senha deve ter entre 8 e 256 caracteres');
  }
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id);
  if (!user) throw new Error('Senha atual incorreta');
  if (!hasLocalPassword(user.password_hash)) {
    throw new Error('Contas conectadas com Google não utilizam senha local');
  }
  return user.password_hash;
}

function applyPasswordUpdate(db, id, newHash, sessionId) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(id, sessionId);
}

export function updatePassword(db, id, currentPassword, newPassword, sessionId) {
  const storedHash = preparePasswordUpdate(db, id, currentPassword, newPassword);
  if (!verifyPassword(currentPassword, storedHash)) throw new Error('Senha atual incorreta');
  applyPasswordUpdate(db, id, hashPassword(newPassword), sessionId);
}

/**
 * Updates user password using non-blocking scrypt verification and hashing.
 */
export async function updatePasswordAsync(
  db,
  id,
  currentPassword,
  newPassword,
  sessionId,
  { runInGate = fn => fn() } = {},
) {
  const storedHash = preparePasswordUpdate(db, id, currentPassword, newPassword);
  const valid = await runInGate(() => verifyPasswordAsync(currentPassword, storedHash));
  if (!valid) throw new Error('Senha atual incorreta');
  const newHash = await runInGate(() => hashPasswordAsync(newPassword));
  applyPasswordUpdate(db, id, newHash, sessionId);
}

export function getUserByUsername(db, username) {
  return db.prepare('SELECT id, username, name, password_hash FROM users WHERE username = ?').get(username.trim().toLowerCase());
}

function lookupCandidateUser(db, username, password) {
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > 256) {
    return null;
  }
  return getUserByUsername(db, username) || null;
}

export function authenticateUser(db, username, password) {
  const user = lookupCandidateUser(db, username, password);
  if (!user) return null;
  if (!verifyPassword(password, user.password_hash)) return null;
  return { id: user.id, username: user.username, name: user.name };
}

/**
 * Authenticates credentials using non-blocking scrypt verification inside an optional concurrency gate.
 */
export async function authenticateUserAsync(db, username, password, { runInGate = fn => fn() } = {}) {
  const user = lookupCandidateUser(db, username, password);
  if (!user) return null;
  const valid = await runInGate(() => verifyPasswordAsync(password, user.password_hash));
  if (!valid) return null;
  return { id: user.id, username: user.username, name: user.name };
}
