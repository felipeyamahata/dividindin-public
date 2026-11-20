import { randomBytes, scrypt, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64; // 64 bytes = 128 hex chars

function parseStoredHash(password, storedHash) {
  if (!password || !storedHash || typeof storedHash !== 'string') return null;
  const [salt, key] = storedHash.split(':');
  if (!salt || !key || key.length !== KEY_LENGTH * 2) return null;
  if (!/^[0-9a-f]+$/i.test(salt) || !/^[0-9a-f]+$/i.test(key)) return null;
  return { salt, keyBuffer: Buffer.from(key, 'hex') };
}

function validatePasswordInput(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
}

/**
 * Hash a plain password with a secure random salt using scrypt (synchronous).
 * Format: "salt:hash" (hex)
 */
export function hashPassword(password) {
  validatePasswordInput(password);
  const salt = randomBytes(16).toString('hex');
  const derivedKey = scryptSync(password, salt, KEY_LENGTH);
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Hash a plain password asynchronously on libuv's worker pool without blocking the event loop.
 */
export async function hashPasswordAsync(password) {
  validatePasswordInput(password);
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt, KEY_LENGTH);
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Verify a plain password against the stored "salt:hash" (synchronous).
 */
export function verifyPassword(password, storedHash) {
  const parsed = parseStoredHash(password, storedHash);
  if (!parsed) return false;
  try {
    const derivedKey = scryptSync(password, parsed.salt, KEY_LENGTH);
    return timingSafeEqual(parsed.keyBuffer, derivedKey);
  } catch {
    return false;
  }
}

/**
 * Verify a plain password asynchronously on libuv's worker pool without blocking the event loop.
 */
export async function verifyPasswordAsync(password, storedHash) {
  const parsed = parseStoredHash(password, storedHash);
  if (!parsed) return false;
  try {
    const derivedKey = await scryptAsync(password, parsed.salt, KEY_LENGTH);
    return timingSafeEqual(parsed.keyBuffer, derivedKey);
  } catch {
    return false;
  }
}

/**
 * Sign a session payload into a tamper-proof token: "base64payload.signature"
 */
export function signSession(payload, secret) {
  const jsonStr = JSON.stringify(payload);
  const data = Buffer.from(jsonStr).toString('base64url');
  const hmac = createHmac('sha256', secret);
  hmac.update(data);
  const signature = hmac.digest('base64url');
  return `${data}.${signature}`;
}

/**
 * Verify and unpack a session token. Returns null if invalid or tampered.
 */
export function verifySession(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, signature] = parts;

  const hmac = createHmac('sha256', secret);
  hmac.update(data);
  const expectedSig = hmac.digest('base64url');

  if (signature.length !== expectedSig.length) return null;
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    const jsonStr = Buffer.from(data, 'base64url').toString('utf-8');
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}
