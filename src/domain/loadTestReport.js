/**
 * Pure domain helpers for staging-only load-test target validation,
 * HTTP latency/status aggregation, and S10e telemetry delta summaries.
 */

const BLOCKED_PRODUCTION_HOSTS = new Set([
  'dividindin.com',
  'www.dividindin.com',
]);

/**
 * Validates that a load-test target points strictly to a non-production staging endpoint.
 */
export function assertSafeStagingTarget(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid target URL: ${rawUrl}`);
  }

  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_PRODUCTION_HOSTS.has(host) || host.endsWith('.trycloudflare.com')) {
    throw new Error(`Blocked load test against production host: ${host}`);
  }

  if (parsed.port === '3001') {
    throw new Error('Blocked load test against production API port 3001');
  }

  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const isStagingPort = parsed.port === '3002';
  if (!isLocal && !isStagingPort) {
    throw new Error(`Target must use localhost or staging port 3002 (received ${parsed.origin})`);
  }

  return parsed.toString().replace(/\/+$/, '');
}

/**
 * Computes a linear-interpolated percentile from a pre-sorted numeric array.
 */
export function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0;
  if (p <= 0) return sortedValues[0];
  if (p >= 100) return sortedValues[sortedValues.length - 1];
  const index = (p / 100) * (sortedValues.length - 1);
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sortedValues[lo];
  const weight = index - lo;
  return sortedValues[lo] * (1 - weight) + sortedValues[hi] * weight;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function summarizeSeries(samples, selector) {
  const values = samples.map(selector).filter((v) => Number.isFinite(v));
  if (!values.length) {
    return { start: null, avg: null, peak: null, end: null };
  }
  const sum = values.reduce((acc, v) => acc + v, 0);
  return {
    start: round1(values[0]),
    avg: round1(sum / values.length),
    peak: round1(Math.max(...values)),
    end: round1(values[values.length - 1]),
  };
}

/**
 * Aggregates HTTP request outcomes and S10e host telemetry snapshots for one stage.
 */
export function summarizeStage({
  name,
  targetRpm,
  durationSeconds,
  results = [],
  samples = [],
}) {
  const latencies = results
    .map((r) => r.latencyMs)
    .filter((ms) => Number.isFinite(ms) && ms >= 0)
    .sort((a, b) => a - b);

  const statuses = {
    ok2xx: 0,
    rateLimited429: 0,
    shed503: 0,
    client4xx: 0,
    server5xx: 0,
    networkErrors: 0,
  };

  for (const item of results) {
    if (item.networkError || !item.status) {
      statuses.networkErrors += 1;
    } else if (item.status >= 200 && item.status < 300) {
      statuses.ok2xx += 1;
    } else if (item.status === 429) {
      statuses.rateLimited429 += 1;
    } else if (item.status === 503) {
      statuses.shed503 += 1;
    } else if (item.status >= 400 && item.status < 500) {
      statuses.client4xx += 1;
    } else if (item.status >= 500) {
      statuses.server5xx += 1;
    }
  }

  const totalRequests = results.length;
  const achievedRpm = durationSeconds > 0 ? round1((totalRequests / durationSeconds) * 60) : 0;

  const firstSample = samples[0] || null;
  const lastSample = samples[samples.length - 1] || null;
  const restartsDelta =
    firstSample && lastSample && Number.isFinite(firstSample.divideDevRestarts) && Number.isFinite(lastSample.divideDevRestarts)
      ? Math.max(0, lastSample.divideDevRestarts - firstSample.divideDevRestarts)
      : 0;

  return {
    name,
    targetRpm,
    durationSeconds,
    totalRequests,
    achievedRpm,
    latencyMs: {
      p50: round1(percentile(latencies, 50)),
      p95: round1(percentile(latencies, 95)),
      p99: round1(percentile(latencies, 99)),
      max: round1(latencies.length ? latencies[latencies.length - 1] : 0),
    },
    statuses,
    s10e: {
      sampleCount: samples.length,
      rssMb: summarizeSeries(samples, (s) => s.divideDevRssMb),
      cpuPct: summarizeSeries(samples, (s) => s.divideDevCpuPct),
      memAvailableMb: summarizeSeries(samples, (s) => s.memAvailableMb),
      loadAvg1m: summarizeSeries(samples, (s) => s.loadAvg1m),
      batteryTempC: summarizeSeries(samples, (s) => s.batteryTempC),
      walSizeKb: summarizeSeries(samples, (s) => s.walSizeKb),
      restartsDelta,
    },
  };
}

/**
 * Evaluates whether S10e staging handled all tested stages within safety thresholds.
 */
export function evaluateVerdict(stageSummaries, { rssCeilingMb = 340 } = {}) {
  const issues = [];
  for (const stage of stageSummaries) {
    if (stage.s10e.restartsDelta > 0) {
      issues.push(`${stage.name}: PM2 reiniciou ${stage.s10e.restartsDelta}x`);
    }
    if (stage.s10e.rssMb.peak !== null && stage.s10e.rssMb.peak >= rssCeilingMb) {
      issues.push(`${stage.name}: RSS atingiu ${stage.s10e.rssMb.peak} MB (teto ${rssCeilingMb} MB)`);
    }
    if (stage.statuses.shed503 > 0) {
      issues.push(`${stage.name}: load shedding retornou ${stage.statuses.shed503}x HTTP 503`);
    }
    if (stage.statuses.client4xx > 0) {
      issues.push(`${stage.name}: ${stage.statuses.client4xx}x respostas HTTP 4xx inesperadas`);
    }
    if (stage.statuses.server5xx > 0) {
      issues.push(`${stage.name}: ${stage.statuses.server5xx}x erros HTTP 5xx`);
    }
    if (stage.statuses.networkErrors > 0) {
      issues.push(`${stage.name}: ${stage.statuses.networkErrors}x falhas de rede`);
    }
  }

  return {
    passed: issues.length === 0,
    issues,
  };
}
