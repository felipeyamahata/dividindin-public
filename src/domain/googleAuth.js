import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ALLOWED_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const CLOCK_SKEW_SECONDS = 30;
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
const MIN_CACHE_TTL_MS = 60 * 1000;
const MAX_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const UNKNOWN_KID_REFRESH_COOLDOWN_MS = 15 * 1000;
const DEFAULT_AVATAR_TIMEOUT_MS = 4000;
const DEFAULT_AVATAR_MAX_BYTES = 85 * 1024;

export class GoogleAuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = 'GoogleAuthError';
    this.status = status;
  }
}

function decodeBase64UrlJson(segment) {
  if (typeof segment !== 'string' || !/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw new GoogleAuthError('Token do Google malformado');
  }
  try {
    const raw = Buffer.from(segment, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid');
    }
    return parsed;
  } catch {
    throw new GoogleAuthError('Token do Google malformado');
  }
}

function parseCacheMaxAgeMs(cacheControlHeader) {
  if (typeof cacheControlHeader !== 'string') return DEFAULT_CACHE_TTL_MS;
  const match = cacheControlHeader.match(/max-age=(\d+)/i);
  if (!match) return DEFAULT_CACHE_TTL_MS;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_CACHE_TTL_MS;
  return Math.min(MAX_CACHE_TTL_MS, Math.max(MIN_CACHE_TTL_MS, seconds * 1000));
}

function isTrustedGoogleImageHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com');
}

/**
 * Normalizes and validates a Google profile picture URL so only trusted HTTPS Google CDN URLs are accepted.
 * Requests a 256px square crop when size parameters are present or absent on `/a/` avatars.
 */
export function normalizeGooglePictureUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim() || rawUrl.length > 1024) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    return null;
  }
  if (!isTrustedGoogleImageHost(parsed.hostname)) {
    return null;
  }
  if (/=s\d+-c$/.test(parsed.pathname)) {
    parsed.pathname = parsed.pathname.replace(/=s\d+-c$/, '=s256-c');
  } else if (parsed.pathname.startsWith('/a/') && !parsed.pathname.includes('=')) {
    parsed.pathname = `${parsed.pathname}=s256-c`;
  }
  return parsed.toString();
}

/**
 * Builds a clean, ASCII-safe base username candidate (<= 48 chars) from a display name.
 */
export function buildCandidateUsername(displayName) {
  const normalized = String(displayName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 48)
    .replace(/\.+$/g, '');

  return normalized || 'usuario';
}

/**
 * Creates a bounded in-memory JWKS key provider for Google's RS256 public keys.
 */
export function createGoogleJwksProvider({
  fetchImpl = globalThis.fetch,
  certsUrl = GOOGLE_CERTS_URL,
  now = () => Date.now(),
} = {}) {
  let cachedKeys = new Map();
  let expiresAtMs = 0;
  let lastFetchMs = 0;

  async function refreshKeys() {
    const response = await fetchImpl(certsUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new GoogleAuthError('Não foi possível validar o login com o Google agora', 503);
    }
    const payload = await response.json().catch(() => null);
    const keys = Array.isArray(payload?.keys) ? payload.keys : null;
    if (!keys) {
      throw new GoogleAuthError('Chaves públicas do Google inválidas', 503);
    }

    const nextKeys = new Map();
    for (const jwk of keys) {
      if (jwk?.kty === 'RSA' && typeof jwk.kid === 'string' && jwk.kid) {
        try {
          nextKeys.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
        } catch {
          // Skip malformed key entry
        }
      }
    }

    const currentMs = now();
    const ttlMs = parseCacheMaxAgeMs(response.headers?.get?.('cache-control'));
    cachedKeys = nextKeys;
    expiresAtMs = currentMs + ttlMs;
    lastFetchMs = currentMs;
    return cachedKeys;
  }

  return async function getPublicKey(kid) {
    if (typeof kid !== 'string' || !kid) return null;
    const currentMs = now();

    if (currentMs >= expiresAtMs || cachedKeys.size === 0) {
      await refreshKeys();
    }

    let key = cachedKeys.get(kid);
    if (!key && currentMs - lastFetchMs >= UNKNOWN_KID_REFRESH_COOLDOWN_MS) {
      await refreshKeys();
      key = cachedKeys.get(kid);
    }
    return key || null;
  };
}

function validateAudience(payload, expectedClientId) {
  const { aud, azp } = payload;
  if (typeof aud === 'string') {
    return aud === expectedClientId;
  }
  if (Array.isArray(aud)) {
    return aud.includes(expectedClientId) && azp === expectedClientId;
  }
  return false;
}

function resolveDisplayName(payload) {
  const candidate = [payload.name, payload.given_name]
    .find(value => typeof value === 'string' && value.trim().length > 0);
  const trimmed = (candidate || 'Usuário').trim().slice(0, 100);
  return trimmed || 'Usuário';
}

/**
 * Cryptographically verifies a Google ID Token (RS256 JWT) and extracts minimal profile claims.
 * Intentionally omits email persistence to align with DiviDinDin!'s zero-personal-data commitment.
 */
export async function verifyGoogleIdToken(credential, {
  clientId,
  getPublicKey,
  now = () => Date.now(),
} = {}) {
  if (!clientId) {
    throw new GoogleAuthError('Login com Google não configurado neste servidor', 503);
  }
  if (typeof credential !== 'string' || !credential.trim() || credential.length > 8192) {
    throw new GoogleAuthError('Credencial do Google ausente ou inválida', 400);
  }

  const parts = credential.trim().split('.');
  if (parts.length !== 3) {
    throw new GoogleAuthError('Token do Google malformado');
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeBase64UrlJson(encodedHeader);
  const payload = decodeBase64UrlJson(encodedPayload);

  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    throw new GoogleAuthError('Algoritmo de assinatura do Google não suportado');
  }

  const publicKey = await getPublicKey(header.kid);
  if (!publicKey) {
    throw new GoogleAuthError('Chave de assinatura do Google não reconhecida');
  }

  let signatureBuffer;
  try {
    signatureBuffer = Buffer.from(encodedSignature, 'base64url');
  } catch {
    throw new GoogleAuthError('Assinatura do Google inválida');
  }

  const isSignatureValid = cryptoVerify(
    'RSA-SHA256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    publicKey,
    signatureBuffer,
  );
  if (!isSignatureValid) {
    throw new GoogleAuthError('Assinatura do token Google inválida');
  }

  if (typeof payload.iss !== 'string' || !ALLOWED_ISSUERS.has(payload.iss)) {
    throw new GoogleAuthError('Emissor do token Google inválido');
  }
  if (!validateAudience(payload, clientId)) {
    throw new GoogleAuthError('Token Google não pertence a este aplicativo');
  }

  const nowSec = Math.floor(now() / 1000);
  if (!Number.isFinite(payload.exp) || nowSec >= payload.exp + CLOCK_SKEW_SECONDS) {
    throw new GoogleAuthError('Sessão do Google expirada; tente novamente');
  }
  if (payload.nbf !== undefined && (!Number.isFinite(payload.nbf) || nowSec + CLOCK_SKEW_SECONDS < payload.nbf)) {
    throw new GoogleAuthError('Token Google ainda não é válido');
  }
  if (typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 255) {
    throw new GoogleAuthError('Identificador de conta Google inválido');
  }

  return {
    sub: payload.sub.trim(),
    name: resolveDisplayName(payload),
    pictureUrl: normalizeGooglePictureUrl(payload.picture),
  };
}

/**
 * Downloads a Google profile avatar once as a bounded JPEG data URI for local `user_avatars` storage.
 * Returns null on network errors, non-JPEG payloads, or oversized images so login never fails.
 */
export async function fetchGoogleAvatarDataUri(pictureUrl, {
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_AVATAR_TIMEOUT_MS,
  maxBytes = DEFAULT_AVATAR_MAX_BYTES,
} = {}) {
  const safeUrl = normalizeGooglePictureUrl(pictureUrl);
  if (!safeUrl || typeof fetchImpl !== 'function') return null;

  try {
    const response = await fetchImpl(safeUrl, {
      headers: { Accept: 'image/jpeg' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;

    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    if (contentType && !contentType.includes('image/jpeg') && !contentType.includes('image/jpg')) {
      return null;
    }

    const declaredLength = Number(response.headers?.get?.('content-length') || 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length < 4 || buffer.length > maxBytes) {
      return null;
    }

    // Verify JPEG magic bytes (SOI marker FF D8 FF)
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
      return null;
    }

    const dataUri = `data:image/jpeg;base64,${buffer.toString('base64')}`;
    return dataUri.length <= 120000 ? dataUri : null;
  } catch {
    return null;
  }
}
