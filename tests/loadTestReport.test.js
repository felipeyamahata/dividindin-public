import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSafeStagingTarget,
  evaluateVerdict,
  percentile,
  summarizeStage,
} from '../src/domain/loadTestReport.js';

describe('loadTestReport domain', () => {
  it('blocks production domains, cloudflare tunnels, and port 3001', () => {
    assert.throws(() => assertSafeStagingTarget('https://dividindin.com/api'), /production host/);
    assert.throws(() => assertSafeStagingTarget('https://www.dividindin.com'), /production host/);
    assert.throws(() => assertSafeStagingTarget('https://abc.trycloudflare.com/api'), /production host/);
    assert.throws(() => assertSafeStagingTarget('http://staging.example.ts.net:3001'), /3001/);
    assert.throws(() => assertSafeStagingTarget('http://example.com:8080'), /staging port 3002/);
  });

  it('allows S10e staging on port 3002 and localhost', () => {
    assert.equal(
      assertSafeStagingTarget('http://staging.example.ts.net:3002/divide/'),
      'http://staging.example.ts.net:3002/divide',
    );
    assert.equal(assertSafeStagingTarget('http://localhost:3002/divide'), 'http://localhost:3002/divide');
  });

  it('computes percentiles accurately', () => {
    const sorted = [10, 20, 30, 40, 50];
    assert.equal(percentile(sorted, 0), 10);
    assert.equal(percentile(sorted, 50), 30);
    assert.equal(percentile(sorted, 95), 48);
    assert.equal(percentile([], 50), 0);
  });

  it('summarizes HTTP statuses, latency percentiles, and S10e telemetry deltas', () => {
    const summary = summarizeStage({
      name: 'mixed-450rpm',
      targetRpm: 450,
      durationSeconds: 120,
      results: [
        { status: 200, latencyMs: 12 },
        { status: 201, latencyMs: 24 },
        { status: 400, latencyMs: 7 },
        { status: 429, latencyMs: 8 },
        { status: 503, latencyMs: 15 },
        { networkError: true, latencyMs: 100 },
      ],
      samples: [
        {
          divideDevRssMb: 74,
          divideDevCpuPct: 2,
          divideDevRestarts: 106,
          memAvailableMb: 2700,
          loadAvg1m: 1.5,
          batteryTempC: 28.7,
          walSizeKb: 2400,
        },
        {
          divideDevRssMb: 92,
          divideDevCpuPct: 18,
          divideDevRestarts: 106,
          memAvailableMb: 2650,
          loadAvg1m: 2.3,
          batteryTempC: 29.4,
          walSizeKb: 2680,
        },
      ],
    });

    assert.equal(summary.totalRequests, 6);
    assert.equal(summary.achievedRpm, 3);
    assert.deepEqual(summary.statuses, {
      ok2xx: 2,
      rateLimited429: 1,
      shed503: 1,
      client4xx: 1,
      server5xx: 0,
      networkErrors: 1,
    });
    assert.equal(summary.s10e.rssMb.start, 74);
    assert.equal(summary.s10e.rssMb.peak, 92);
    assert.equal(summary.s10e.batteryTempC.peak, 29.4);
    assert.equal(summary.s10e.restartsDelta, 0);

    const verdict = evaluateVerdict([summary]);
    assert.equal(verdict.passed, false);
    assert.equal(verdict.issues.length, 3);
  });
});
