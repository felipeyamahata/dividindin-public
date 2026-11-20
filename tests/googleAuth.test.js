import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, createSign, generateKeyPairSync } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import { DatabaseSync } from 'node:sqlite';
import {
  GoogleAuthError,
  buildCandidateUsername,
  createGoogleJwksProvider,
  fetchGoogleAvatarDataUri,
  normalizeGooglePictureUrl,
  verifyGoogleIdToken,
} from '../src/domain/googleAuth.js';
import { setDb } from '../src/db/connection.js';
import { initSchema } from '../src/db/schema.js';
import {
  authenticateUserAsync,
  createOrFindOAuthUser,
  getUserById,
  updateDisplayName,
  updatePasswordAsync,
} from '../src/db/users.js';
import { authMiddleware } from '../src/middleware/auth.js';
import { createAuthRouter } from '../src/routes/auth.js';

function createSignedJwt({ header, payload, privateKey }) {
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

function makeFakeJpeg(markerByte = 0xe0, extraBytes = 12) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, markerByte]),
    Buffer.alloc(extraBytes, 0x42),
  ]);
}

test('buildCandidateUsername normalizes accents, punctuation, length, and empty fallback', () => {
  assert.equal(buildCandidateUsername('Felipe Yamahata'), 'felipe.yamahata');
  assert.equal(buildCandidateUsername('Ágata São-José ✨'), 'agata.sao.jose');
  assert.equal(buildCandidateUsername('   ***   '), 'usuario');
  assert.equal(buildCandidateUsername('A'.repeat(70)).length, 48);
});

test('normalizeGooglePictureUrl enforces HTTPS Google CDN and upgrades avatar size', () => {
  assert.equal(
    normalizeGooglePictureUrl('https://lh3.googleusercontent.com/a/ACg8ocTest=s96-c'),
    'https://lh3.googleusercontent.com/a/ACg8ocTest=s256-c',
  );
  assert.equal(
    normalizeGooglePictureUrl('https://lh3.googleusercontent.com/a/ACg8ocTest'),
    'https://lh3.googleusercontent.com/a/ACg8ocTest=s256-c',
  );
  assert.equal(normalizeGooglePictureUrl('http://lh3.googleusercontent.com/a/test=s96-c'), null);
  assert.equal(normalizeGooglePictureUrl('https://evil.example.com/avatar.jpg'), null);
  assert.equal(normalizeGooglePictureUrl('https://user:pass@lh3.googleusercontent.com/a/test'), null);
  assert.equal(normalizeGooglePictureUrl('not-a-url'), null);
});

test('verifyGoogleIdToken validates RS256 signature, JWKS caching, and claims without exposing email', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'key-1', alg: 'RS256', use: 'sig' };

  let certFetches = 0;
  let currentNowMs = 1_700_000_000_000;
  const getPublicKey = createGoogleJwksProvider({
    now: () => currentNowMs,
    fetchImpl: async () => {
      certFetches += 1;
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' },
      });
    },
  });

  const nowSec = Math.floor(currentNowMs / 1000);
  const validToken = createSignedJwt({
    header: { alg: 'RS256', kid: 'key-1', typ: 'JWT' },
    payload: {
      iss: 'https://accounts.google.com',
      aud: 'client-123.apps.googleusercontent.com',
      sub: 'google-sub-001',
      name: 'Mariana Costa',
      email: 'mariana@example.com',
      picture: 'https://lh3.googleusercontent.com/a/mariana=s96-c',
      iat: nowSec - 10,
      exp: nowSec + 3600,
    },
    privateKey,
  });

  const identity = await verifyGoogleIdToken(validToken, {
    clientId: 'client-123.apps.googleusercontent.com',
    getPublicKey,
    now: () => currentNowMs,
  });
  assert.deepEqual(identity, {
    sub: 'google-sub-001',
    name: 'Mariana Costa',
    pictureUrl: 'https://lh3.googleusercontent.com/a/mariana=s256-c',
  });
  assert.equal('email' in identity, false);
  assert.equal(certFetches, 1);

  // Cached JWKS should be reused without another fetch
  await verifyGoogleIdToken(validToken, {
    clientId: 'client-123.apps.googleusercontent.com',
    getPublicKey,
    now: () => currentNowMs + 30_000,
  });
  assert.equal(certFetches, 1);

  // Wrong audience must be rejected
  const wrongAudToken = createSignedJwt({
    header: { alg: 'RS256', kid: 'key-1', typ: 'JWT' },
    payload: {
      iss: 'https://accounts.google.com',
      aud: 'other-app.apps.googleusercontent.com',
      sub: 'google-sub-001',
      exp: nowSec + 3600,
    },
    privateKey,
  });
  await assert.rejects(
    () => verifyGoogleIdToken(wrongAudToken, {
      clientId: 'client-123.apps.googleusercontent.com',
      getPublicKey,
      now: () => currentNowMs,
    }),
    (err) => err instanceof GoogleAuthError && err.status === 401,
  );

  // Expired token must be rejected
  const expiredToken = createSignedJwt({
    header: { alg: 'RS256', kid: 'key-1', typ: 'JWT' },
    payload: {
      iss: 'https://accounts.google.com',
      aud: 'client-123.apps.googleusercontent.com',
      sub: 'google-sub-001',
      exp: nowSec - 120,
    },
    privateKey,
  });
  await assert.rejects(
    () => verifyGoogleIdToken(expiredToken, {
      clientId: 'client-123.apps.googleusercontent.com',
      getPublicKey,
      now: () => currentNowMs,
    }),
    (err) => err instanceof GoogleAuthError && err.status === 401,
  );

  // Tampered payload must fail signature verification
  const parts = validToken.split('.');
  const tamperedPayload = Buffer.from(JSON.stringify({
    iss: 'https://accounts.google.com',
    aud: 'client-123.apps.googleusercontent.com',
    sub: 'attacker-sub',
    exp: nowSec + 3600,
  })).toString('base64url');
  await assert.rejects(
    () => verifyGoogleIdToken(`${parts[0]}.${tamperedPayload}.${parts[2]}`, {
      clientId: 'client-123.apps.googleusercontent.com',
      getPublicKey,
      now: () => currentNowMs,
    }),
    (err) => err instanceof GoogleAuthError && err.status === 401,
  );
});

test('fetchGoogleAvatarDataUri accepts bounded JPEG images and safely returns null on invalid payloads', async () => {
  const jpegBytes = makeFakeJpeg();
  const dataUri = await fetchGoogleAvatarDataUri('https://lh3.googleusercontent.com/a/photo=s96-c', {
    fetchImpl: async (url) => {
      assert.equal(url, 'https://lh3.googleusercontent.com/a/photo=s256-c');
      return new Response(jpegBytes, {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      });
    },
  });
  assert.equal(dataUri, `data:image/jpeg;base64,${jpegBytes.toString('base64')}`);

  // Reject non-JPEG payload even if Content-Type claims image/jpeg
  const pngSpoof = await fetchGoogleAvatarDataUri('https://lh3.googleusercontent.com/a/photo=s96-c', {
    fetchImpl: async () => new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
    }),
  });
  assert.equal(pngSpoof, null);

  // Reject oversized image
  const oversized = await fetchGoogleAvatarDataUri('https://lh3.googleusercontent.com/a/photo=s96-c', {
    maxBytes: 10,
    fetchImpl: async () => new Response(jpegBytes, {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
    }),
  });
  assert.equal(oversized, null);

  // Reject non-Google URL without calling fetch
  let called = false;
  const untrusted = await fetchGoogleAvatarDataUri('https://example.com/photo.jpg', {
    fetchImpl: async () => {
      called = true;
      return new Response(jpegBytes);
    },
  });
  assert.equal(untrusted, null);
  assert.equal(called, false);
});

test('createOrFindOAuthUser creates passwordless accounts, resolves username collisions, and preserves user edits', async () => {
  const db = new DatabaseSync(':memory:');
  initSchema(db);

  const initialAvatar = `data:image/jpeg;base64,${makeFakeJpeg().toString('base64')}`;
  const first = createOrFindOAuthUser(db, {
    provider: 'google',
    providerUserId: 'sub-1',
    name: 'João Pedro',
    avatarImage: initialAvatar,
  });
  assert.equal(first.isNewUser, true);
  assert.equal(first.user.username, 'joao.pedro');
  assert.equal(first.user.name, 'João Pedro');
  assert.equal(first.user.has_password, false);
  assert.ok(first.user.avatar_version);

  // Another Google user with the same display name gets a distinct username
  const second = createOrFindOAuthUser(db, {
    provider: 'google',
    providerUserId: 'sub-2',
    name: 'João Pedro',
  });
  assert.equal(second.isNewUser, true);
  assert.match(second.user.username, /^joao\.pedro_[0-9a-f]{4}$/);
  assert.equal(second.user.avatar_version, null);

  // User customizes display name in-app; subsequent Google login must preserve it
  updateDisplayName(db, first.user.id, 'JP Apelido');
  const returning = createOrFindOAuthUser(db, {
    provider: 'google',
    providerUserId: 'sub-1',
    name: 'João Pedro',
    avatarImage: null,
  });
  assert.equal(returning.isNewUser, false);
  assert.equal(returning.user.id, first.user.id);
  assert.equal(returning.user.name, 'JP Apelido');

  // Password login and password change are rejected for Google-only accounts
  assert.equal(await authenticateUserAsync(db, first.user.username, '!oauth-no-password'), null);
  await assert.rejects(
    () => updatePasswordAsync(db, first.user.id, 'anything', 'newpassword123', 'sess-1'),
    /Google/,
  );
  assert.equal(getUserById(db, first.user.id).has_password, false);
});

test('HTTP POST /api/auth/google handles signup, avatar seeding, subsequent login preservation, and errors', async (t) => {
  const testDb = new DatabaseSync(':memory:');
  initSchema(testDb);
  setDb(testDb);

  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-kid', alg: 'RS256' };
  const initialJpeg = makeFakeJpeg(0xe0, 16);
  let avatarFetchCalls = 0;
  let configuredClientId = 'divide-web.apps.googleusercontent.com';

  const authRouter = createAuthRouter({
    getGoogleClientId: () => configuredClientId,
    verifyGoogleToken: (credential, { clientId }) => verifyGoogleIdToken(credential, {
      clientId,
      getPublicKey: async (kid) => (kid === 'test-kid' ? createPublicKeyFromJwk(jwk) : null),
    }),
    fetchGoogleAvatar: async (url) => {
      avatarFetchCalls += 1;
      assert.equal(url, 'https://lh3.googleusercontent.com/a/camila=s256-c');
      return `data:image/jpeg;base64,${initialJpeg.toString('base64')}`;
    },
  });

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use('/api/auth', authRouter);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;

  const nowSec = Math.floor(Date.now() / 1000);
  const token = createSignedJwt({
    header: { alg: 'RS256', kid: 'test-kid', typ: 'JWT' },
    payload: {
      iss: 'https://accounts.google.com',
      aud: configuredClientId,
      sub: 'google-camila-99',
      name: 'Camila Rocha',
      picture: 'https://lh3.googleusercontent.com/a/camila=s96-c',
      exp: nowSec + 1800,
    },
    privateKey,
  });

  // 1. First Google sign-in creates account and downloads avatar once
  let res = await fetch(`${baseUrl}/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-Mode': 'pwa' },
    body: JSON.stringify({ credential: token }),
  });
  assert.equal(res.status, 201);
  const firstLogin = await res.json();
  assert.equal(firstLogin.isNewUser, true);
  assert.equal(firstLogin.user.name, 'Camila Rocha');
  assert.equal(firstLogin.user.has_password, false);
  assert.ok(firstLogin.user.avatar_version);
  assert.ok(firstLogin.token);
  assert.equal(avatarFetchCalls, 1);

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${firstLogin.token}`,
  };

  // Seeded avatar is retrievable via standard /avatar endpoint
  res = await fetch(`${baseUrl}/avatar`, { headers: authHeaders });
  assert.equal(res.status, 200);
  const seededAvatar = await res.json();
  assert.equal(seededAvatar.avatar.image, `data:image/jpeg;base64,${initialJpeg.toString('base64')}`);

  // 2. User edits display name and uploads a custom avatar inside the app
  res = await fetch(`${baseUrl}/profile`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ name: 'Cami' }),
  });
  assert.equal(res.status, 200);

  const customAvatar = 'data:image/jpeg;base64,/9j/CUSTOMAVATAR';
  res = await fetch(`${baseUrl}/avatar`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ image: customAvatar }),
  });
  assert.equal(res.status, 200);

  // 3. Second Google sign-in logs into existing account without re-fetching avatar or overwriting edits
  res = await fetch(`${baseUrl}/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: token }),
  });
  assert.equal(res.status, 200);
  const secondLogin = await res.json();
  assert.equal(secondLogin.isNewUser, false);
  assert.equal(secondLogin.user.id, firstLogin.user.id);
  assert.equal(secondLogin.user.name, 'Cami');
  assert.equal(avatarFetchCalls, 1);

  res = await fetch(`${baseUrl}/avatar`, { headers: authHeaders });
  assert.equal((await res.json()).avatar.image, customAvatar);

  // 4. Invalid credential returns 401 and logs failed attempt
  res = await fetch(`${baseUrl}/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: 'invalid.jwt.value' }),
  });
  assert.equal(res.status, 401);

  // 5. Missing GOOGLE_CLIENT_ID returns 503
  configuredClientId = '';
  res = await fetch(`${baseUrl}/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: token }),
  });
  assert.equal(res.status, 503);

  const logs = testDb.prepare('SELECT event_type, metadata FROM activity_logs ORDER BY id ASC').all();
  assert.equal(logs.some(l => l.event_type === 'user_registered' && l.metadata.includes('"provider":"google"')), true);
  assert.equal(logs.some(l => l.event_type === 'login_success' && l.metadata.includes('"provider":"google"')), true);
  assert.equal(logs.some(l => l.event_type === 'login_failed' && l.metadata.includes('"provider":"google"')), true);
});

function createPublicKeyFromJwk(jwk) {
  return createPublicKey({ key: jwk, format: 'jwk' });
}
