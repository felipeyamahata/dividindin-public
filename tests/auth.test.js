import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, signSession, verifySession } from '../src/domain/auth.js';

test('Password hashing and verification', () => {
  const pwd = 'minhasenhaforte123';
  const hash = hashPassword(pwd);

  assert.ok(hash.includes(':'));
  assert.equal(verifyPassword(pwd, hash), true);
  assert.equal(verifyPassword('senhaerrada', hash), false);
  assert.equal(verifyPassword('', hash), false);
  assert.equal(verifyPassword(pwd, 'invalid:format'), false);
});

test('Session token signing and tampering detection', () => {
  const secret = 'super-secret-key-32-bytes-minimum!';
  const payload = { userId: 'usr_123', username: 'felipe' };

  const token = signSession(payload, secret);
  assert.ok(token.includes('.'));

  const decoded = verifySession(token, secret);
  assert.deepEqual(decoded, payload);

  // Tampered payload
  const tamperedToken = 'tampered' + token.slice(8);
  assert.equal(verifySession(tamperedToken, secret), null);

  // Wrong secret
  assert.equal(verifySession(token, 'another-secret'), null);
});
