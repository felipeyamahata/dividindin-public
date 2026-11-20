import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRateLimitIp } from '../src/domain/clientIp.js';

describe('resolveRateLimitIp', () => {
  it('ignores x-dev-client-ip in production even if allowDevSimulatedIp is true', () => {
    const req = {
      socket: { remoteAddress: '100.64.0.10' },
      headers: { 'x-dev-client-ip': '198.51.100.5' },
    };
    assert.equal(
      resolveRateLimitIp(req, { isProd: true, allowDevSimulatedIp: true }),
      '100.64.0.10',
    );
  });

  it('uses valid x-dev-client-ip only in non-production when explicitly enabled', () => {
    const req = {
      socket: { remoteAddress: '100.64.0.10' },
      headers: { 'x-dev-client-ip': '198.51.100.5' },
    };
    assert.equal(
      resolveRateLimitIp(req, { isProd: false, allowDevSimulatedIp: false }),
      '100.64.0.10',
    );
    assert.equal(
      resolveRateLimitIp(req, { isProd: false, allowDevSimulatedIp: true }),
      '198.51.100.5',
    );
  });

  it('rejects malformed simulated IPs and falls back to peer', () => {
    const req = {
      socket: { remoteAddress: '100.64.0.10' },
      headers: { 'x-dev-client-ip': '198.51.100.5, evil' },
    };
    assert.equal(
      resolveRateLimitIp(req, { isProd: false, allowDevSimulatedIp: true }),
      '100.64.0.10',
    );
  });

  it('trusts cf-connecting-ip only from loopback when trustCloudflareProxy is true', () => {
    const loopbackReq = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'cf-connecting-ip': '203.0.113.9' },
    };
    const publicReq = {
      socket: { remoteAddress: '192.0.2.4' },
      headers: { 'cf-connecting-ip': '203.0.113.9' },
    };

    assert.equal(
      resolveRateLimitIp(loopbackReq, { isProd: true, trustCloudflareProxy: true }),
      '203.0.113.9',
    );
    assert.equal(
      resolveRateLimitIp(publicReq, { isProd: true, trustCloudflareProxy: true }),
      '192.0.2.4',
    );
  });
});
