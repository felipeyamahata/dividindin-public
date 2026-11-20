/**
 * Pure/injectable USD -> BRL exchange rate resolver with TTL caching and fallback.
 */

export const DEFAULT_USD_BRL_FALLBACK = 5.8;
export const DEFAULT_USD_RATE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
export const AWESOME_USD_BRL_URL = 'https://economia.awesomeapi.com.br/json/last/USD-BRL';

/**
 * Parses AwesomeAPI USD-BRL JSON response into a positive rate number.
 * @param {unknown} payload
 * @returns {number | null}
 */
export function parseAwesomeUsdBrlResponse(payload) {
  const raw = payload?.USDBRL?.bid ?? payload?.USDBRL?.ask;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0.5 || parsed >= 100) {
    return null;
  }
  return Math.round(parsed * 10000) / 10000;
}

/**
 * Creates a resilient USD -> BRL rate provider with memory TTL + persisted/manual fallback.
 * @param {{
 *   fetcher?: (url: string) => Promise<unknown>,
 *   ttlMs?: number,
 *   url?: string,
 * }} [options]
 */
export function createUsdRateProvider({
  fetcher = null,
  ttlMs = DEFAULT_USD_RATE_TTL_MS,
  url = AWESOME_USD_BRL_URL,
} = {}) {
  let memoryCache = null;

  const defaultFetcher = async (targetUrl) => {
    const response = await fetch(targetUrl, {
      signal: AbortSignal.timeout(2500),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`USD rate HTTP ${response.status}`);
    }
    return response.json();
  };

  const runFetch = fetcher || defaultFetcher;

  /**
   * Resolves the current USD -> BRL rate without throwing on upstream failure.
   * @param {{
   *   useAuto?: boolean,
   *   fallbackRate?: number,
   *   persistedRate?: number | null,
   *   persistedAt?: string | null,
   *   nowMs?: number,
   *   onRateFetched?: (rate: number, isoTime: string) => void,
   * }} [params]
   * @returns {Promise<{ rate: number, source: 'manual' | 'auto-live' | 'auto-cache' | 'fallback', updatedAt: string | null }>}
   */
  async function resolveRate({
    useAuto = true,
    fallbackRate = DEFAULT_USD_BRL_FALLBACK,
    persistedRate = null,
    persistedAt = null,
    nowMs = Date.now(),
    onRateFetched = null,
  } = {}) {
    const safeFallback = Number.isFinite(Number(fallbackRate)) && Number(fallbackRate) > 0
      ? Number(fallbackRate)
      : DEFAULT_USD_BRL_FALLBACK;

    if (!useAuto) {
      return { rate: safeFallback, source: 'manual', updatedAt: null };
    }

    if (memoryCache && nowMs - memoryCache.fetchedAtMs < ttlMs) {
      return {
        rate: memoryCache.rate,
        source: 'auto-cache',
        updatedAt: memoryCache.updatedAt,
      };
    }

    const persistedMs = persistedAt ? Date.parse(persistedAt) : NaN;
    if (
      Number.isFinite(Number(persistedRate))
      && Number(persistedRate) > 0
      && Number.isFinite(persistedMs)
      && nowMs - persistedMs < ttlMs
    ) {
      memoryCache = {
        rate: Number(persistedRate),
        fetchedAtMs: persistedMs,
        updatedAt: persistedAt,
      };
      return {
        rate: Number(persistedRate),
        source: 'auto-cache',
        updatedAt: persistedAt,
      };
    }

    try {
      const payload = await runFetch(url);
      const parsed = parseAwesomeUsdBrlResponse(payload);
      if (parsed) {
        const updatedAt = new Date(nowMs).toISOString();
        memoryCache = { rate: parsed, fetchedAtMs: nowMs, updatedAt };
        onRateFetched?.(parsed, updatedAt);
        return { rate: parsed, source: 'auto-live', updatedAt };
      }
    } catch {
      // Fall through to persisted or manual fallback.
    }

    if (Number.isFinite(Number(persistedRate)) && Number(persistedRate) > 0) {
      return {
        rate: Number(persistedRate),
        source: 'auto-cache',
        updatedAt: persistedAt || null,
      };
    }

    return { rate: safeFallback, source: 'fallback', updatedAt: null };
  }

  return {
    resolveRate,
    clearCache() {
      memoryCache = null;
    },
  };
}
