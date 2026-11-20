export const DEFAULT_PRESENCE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_MAX_ACTIVE_USERS = 2000;
export const DEFAULT_USER_THROTTLE_MS = 15 * 1000;
export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;
export const DEFAULT_MAX_RSS_BYTES = 320 * 1024 * 1024;

/**
 * Ephemeral in-memory presence tracker with automatic concurrency and RSS circuit breaker.
 * Zero disk or SQLite writes; falls back to SQLite activity_logs (Option A) when degraded.
 */
export function createPresenceTracker({
  ttlMs = DEFAULT_PRESENCE_TTL_MS,
  maxUsers = DEFAULT_MAX_ACTIVE_USERS,
  userThrottleMs = DEFAULT_USER_THROTTLE_MS,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  maxRssBytes = DEFAULT_MAX_RSS_BYTES,
  getRssBytes = () => process.memoryUsage().rss,
} = {}) {
  const entries = new Map();
  let cooldownUntil = 0;
  let degradedReason = null;

  function pruneExpired(nowMs) {
    for (const [userId, entry] of entries) {
      if (nowMs - entry.lastActiveMs > ttlMs) {
        entries.delete(userId);
      }
    }
  }

  function tripBreaker(reason, nowMs) {
    entries.clear();
    cooldownUntil = nowMs + cooldownMs;
    degradedReason = reason;
  }

  function isInCooldown(nowMs) {
    if (nowMs < cooldownUntil) return true;
    if (cooldownUntil !== 0) {
      cooldownUntil = 0;
      degradedReason = null;
    }
    return false;
  }

  function record(user, { clientMode = null, route = null, nowMs = Date.now() } = {}) {
    if (!user || !user.id) {
      return { recorded: false, degraded: isInCooldown(nowMs), reason: degradedReason };
    }

    if (isInCooldown(nowMs)) {
      return { recorded: false, degraded: true, reason: degradedReason };
    }

    const rssBytes = Number(getRssBytes() || 0);
    if (rssBytes >= maxRssBytes) {
      tripBreaker('high-memory', nowMs);
      return { recorded: false, degraded: true, reason: 'high-memory' };
    }

    const existing = entries.get(user.id);
    if (existing) {
      if (
        nowMs - existing.lastActiveMs < userThrottleMs
        && existing.clientMode === (clientMode || existing.clientMode)
      ) {
        return { recorded: false, throttled: true, degraded: false };
      }
      entries.set(user.id, {
        userId: user.id,
        username: user.username || existing.username || null,
        name: user.name || existing.name || null,
        clientMode: clientMode || existing.clientMode || null,
        route: route || existing.route || null,
        lastActiveMs: nowMs,
      });
      return { recorded: true, degraded: false };
    }

    if (entries.size >= maxUsers) {
      pruneExpired(nowMs);
      if (entries.size >= maxUsers) {
        tripBreaker('high-concurrency', nowMs);
        return { recorded: false, degraded: true, reason: 'high-concurrency' };
      }
    }

    entries.set(user.id, {
      userId: user.id,
      username: user.username || null,
      name: user.name || null,
      clientMode: clientMode || null,
      route: route || null,
      lastActiveMs: nowMs,
    });
    return { recorded: true, degraded: false };
  }

  function snapshot({ nowMs = Date.now(), limit = 100 } = {}) {
    const rssBytes = Number(getRssBytes() || 0);
    const rssMb = Number((rssBytes / (1024 * 1024)).toFixed(1));
    const ttlMinutes = Math.round(ttlMs / 60000);

    if (isInCooldown(nowMs)) {
      return {
        source: 'memory-ttl',
        degraded: true,
        reason: degradedReason,
        maxUsers,
        ttlMinutes,
        rssMb,
        cooldownUntil: new Date(cooldownUntil).toISOString(),
        count: 0,
        pwaCount: 0,
        browserCount: 0,
        users: [],
      };
    }

    if (rssBytes >= maxRssBytes) {
      tripBreaker('high-memory', nowMs);
      return {
        source: 'memory-ttl',
        degraded: true,
        reason: 'high-memory',
        maxUsers,
        ttlMinutes,
        rssMb,
        cooldownUntil: new Date(cooldownUntil).toISOString(),
        count: 0,
        pwaCount: 0,
        browserCount: 0,
        users: [],
      };
    }

    pruneExpired(nowMs);

    const active = Array.from(entries.values())
      .sort((a, b) => b.lastActiveMs - a.lastActiveMs);

    let pwaCount = 0;
    let browserCount = 0;
    for (const item of active) {
      if (item.clientMode === 'pwa') pwaCount += 1;
      else if (item.clientMode === 'browser') browserCount += 1;
    }

    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 100));
    return {
      source: 'memory-ttl',
      degraded: false,
      reason: null,
      maxUsers,
      ttlMinutes,
      rssMb,
      cooldownUntil: null,
      count: active.length,
      pwaCount,
      browserCount,
      users: active.slice(0, safeLimit).map((item) => ({
        userId: item.userId,
        username: item.username,
        name: item.name,
        clientMode: item.clientMode,
        route: item.route,
        lastActiveAt: new Date(item.lastActiveMs).toISOString(),
      })),
    };
  }

  function remove(userId) {
    if (!userId) return false;
    return entries.delete(userId);
  }

  function clear() {
    entries.clear();
    cooldownUntil = 0;
    degradedReason = null;
  }

  return { record, remove, snapshot, clear };
}

export const presenceTracker = createPresenceTracker();
