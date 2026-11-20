import { monitorEventLoopDelay } from 'node:perf_hooks';

export const DEFAULT_LOAD_SHEDDING_RSS_BYTES = 340 * 1024 * 1024;
export const DEFAULT_MAX_EVENT_LOOP_LAG_MS = 250;
export const DEFAULT_RETRY_AFTER_SECONDS = 5;
export const DEFAULT_EXEMPT_PATHS = ['/health', '/divide/health', '/internal/presence'];

/**
 * Creates a lightweight event-loop lag sampler that resets every second and does not block process exit.
 */
export function createEventLoopLagSampler(sampleIntervalMs = 1000) {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  let currentLagMs = 0;

  const timer = setInterval(() => {
    const p95Ms = histogram.percentile(95) / 1e6;
    currentLagMs = Number.isFinite(p95Ms) ? p95Ms : 0;
    histogram.reset();
  }, sampleIntervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  return {
    getLagMs: () => currentLagMs,
    stop: () => {
      clearInterval(timer);
      histogram.disable();
    },
  };
}

/**
 * Middleware that sheds excess API traffic with HTTP 503 + Retry-After before RSS hits the 384 MB ceiling
 * or event-loop delay degrades all active users.
 */
export function createLoadSheddingMiddleware({
  maxRssBytes = DEFAULT_LOAD_SHEDDING_RSS_BYTES,
  maxEventLoopLagMs = DEFAULT_MAX_EVENT_LOOP_LAG_MS,
  retryAfterSeconds = DEFAULT_RETRY_AFTER_SECONDS,
  exemptPaths = DEFAULT_EXEMPT_PATHS,
  getRssBytes = () => process.memoryUsage().rss,
  getEventLoopLagMs = null,
} = {}) {
  const sampler = getEventLoopLagMs ? null : createEventLoopLagSampler();
  const readLagMs = getEventLoopLagMs || (() => sampler.getLagMs());
  const exemptSet = new Set(exemptPaths);

  function middleware(req, res, next) {
    if (exemptSet.has(req.path)) return next();

    const rssBytes = Number(getRssBytes() || 0);
    const lagMs = Number(readLagMs() || 0);

    if (rssBytes >= maxRssBytes || lagMs >= maxEventLoopLagMs) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(503).json({
        error: 'Servidor temporariamente sobrecarregado. Tente novamente em alguns segundos.',
      });
    }

    next();
  }

  middleware.stop = () => {
    if (sampler) sampler.stop();
  };

  return middleware;
}
