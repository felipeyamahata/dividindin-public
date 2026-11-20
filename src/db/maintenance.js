import { pruneOldActivityLogs } from './telemetry.js';

export const DEFAULT_MAINTENANCE_INTERVAL_MS = 15 * 60 * 1000;
export const DEFAULT_LOG_RETENTION_DAYS = 90;

/**
 * Removes expired sessions and aged activity logs outside hot authentication requests.
 */
export function runMaintenanceSweep(
  db,
  { retentionDays = DEFAULT_LOG_RETENTION_DAYS, nowMs = Date.now() } = {},
) {
  if (!db) {
    return { expiredSessionsDeleted: 0, prunedActivityLogs: 0 };
  }

  let expiredSessionsDeleted = 0;
  try {
    const result = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowMs);
    expiredSessionsDeleted = Number(result?.changes || 0);
  } catch {
    expiredSessionsDeleted = 0;
  }

  const prunedActivityLogs = pruneOldActivityLogs(db, retentionDays, nowMs);
  return { expiredSessionsDeleted, prunedActivityLogs };
}

/**
 * Schedules periodic SQLite maintenance sweeps with an unref'd timer.
 */
export function startMaintenanceScheduler(
  getDbFn,
  {
    intervalMs = DEFAULT_MAINTENANCE_INTERVAL_MS,
    retentionDays = DEFAULT_LOG_RETENTION_DAYS,
    runInitial = true,
  } = {},
) {
  const sweep = () => {
    try {
      const db = getDbFn();
      if (db) runMaintenanceSweep(db, { retentionDays });
    } catch {
      // Background cleanup must never crash the server.
    }
  };

  if (runInitial) sweep();

  const timer = setInterval(sweep, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}
