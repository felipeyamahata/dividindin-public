export const MIN_EVENT_LOADING_MS = 1500;
export const EVENT_LOADING_ENTRY_FLIGHT_MS = 260;
export const EVENT_LOADING_EXIT_FLIGHT_MS = 360;

/**
 * Computes how many milliseconds remain before the minimum loading duration has elapsed.
 * @param {object} params
 * @param {number} params.startedAt Timestamp (ms) when loading started.
 * @param {number} params.now Current timestamp (ms).
 * @param {number} [params.minDurationMs] Minimum visible loading duration (default 1500ms).
 * @returns {number}
 */
export function computeRemainingLoadingMs({
  startedAt,
  now,
  minDurationMs = MIN_EVENT_LOADING_MS,
}) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return 0;
  const elapsed = Math.max(0, now - startedAt);
  return Math.max(0, minDurationMs - elapsed);
}
