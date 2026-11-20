const IP_LITERAL_RE = /^[a-fA-F0-9:.]{2,45}$/;
const LOOPBACK_PEERS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Resolves the effective client IP for rate-limiting without trusting spoofed headers in production.
 */
export function resolveRateLimitIp(req, {
  isProd = true,
  trustCloudflareProxy = false,
  allowDevSimulatedIp = false,
} = {}) {
  const peer = req.socket?.remoteAddress || '';

  if (!isProd && allowDevSimulatedIp) {
    const simulated = req.headers?.['x-dev-client-ip'];
    if (typeof simulated === 'string' && IP_LITERAL_RE.test(simulated)) {
      return simulated;
    }
  }

  const trustedProxy = trustCloudflareProxy && LOOPBACK_PEERS.has(peer);
  const forwarded = trustedProxy ? req.headers?.['cf-connecting-ip'] : null;
  if (typeof forwarded === 'string' && IP_LITERAL_RE.test(forwarded)) {
    return forwarded;
  }

  return peer;
}
