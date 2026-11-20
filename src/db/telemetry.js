const ALLOWED_CLIENT_MODES = new Set(['pwa', 'browser']);
const DEFAULT_LAST_SEEN_THROTTLE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 90;

/**
 * Normalizes the client display mode header into a bounded enum or null.
 * @param {unknown} value
 * @returns {'pwa' | 'browser' | null}
 */
export function normalizeClientMode(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return ALLOWED_CLIENT_MODES.has(normalized) ? normalized : null;
}

function serializeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;
  const serialized = JSON.stringify(metadata);
  if (!serialized || serialized === '{}') return null;
  return serialized.length > 1024 ? serialized.slice(0, 1024) : serialized;
}

/**
 * Appends a lightweight operational/product event to activity_logs.
 */
export function recordActivityLog(db, {
  eventType,
  userId = null,
  eventId = null,
  metadata = null,
  createdAt = new Date().toISOString(),
}) {
  if (!db || typeof eventType !== 'string' || !eventType.trim()) return;
  try {
    db.prepare(`
      INSERT INTO activity_logs (event_type, user_id, event_id, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      eventType.trim().slice(0, 64),
      userId || null,
      eventId || null,
      serializeMetadata(metadata),
      createdAt,
    );
  } catch {
    // Telemetry writes must never break core user actions.
  }
}

/**
 * Deletes activity_logs entries older than the configured retention window.
 */
export function pruneOldActivityLogs(db, retentionDays = DEFAULT_RETENTION_DAYS, nowMs = Date.now()) {
  if (!db) return 0;
  const cutoffIso = new Date(nowMs - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  try {
    const result = db.prepare('DELETE FROM activity_logs WHERE created_at < ?').run(cutoffIso);
    return Number(result?.changes || 0);
  } catch {
    return 0;
  }
}

/**
 * Updates users.last_seen_at only when the previous timestamp is missing or older than the throttle interval.
 */
export function touchUserLastSeen(
  db,
  userId,
  currentLastSeenAt = null,
  nowMs = Date.now(),
  minIntervalMs = DEFAULT_LAST_SEEN_THROTTLE_MS,
) {
  if (!db || !userId) return false;
  if (currentLastSeenAt) {
    const parsed = Date.parse(currentLastSeenAt);
    if (Number.isFinite(parsed) && nowMs - parsed < minIntervalMs) {
      return false;
    }
  }
  const nowIso = new Date(nowMs).toISOString();
  try {
    db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(nowIso, userId);
    return true;
  } catch {
    return false;
  }
}
