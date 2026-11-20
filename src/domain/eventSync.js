/**
 * Pure domain helpers for real-time event synchronization, snapshot diffing,
 * SSE frame parsing, reconnect backoff, and feed pill formatting.
 */

export const SSE_HEARTBEAT_INTERVAL_MS = 25000;
export const FEED_TOP_SCROLL_THRESHOLD_PX = 16;

function toIdSet(ids = []) {
  return new Set(ids.filter(Boolean));
}

function findAddedIds(prevIds = [], nextIds = []) {
  const prevSet = toIdSet(prevIds);
  const added = [];
  for (const id of nextIds) {
    if (id && !prevSet.has(id)) {
      added.push(id);
    }
  }
  return added;
}

/**
 * Computes incremental differences between two snapshots of an event so the UI
 * can animate only newly arrived feed items, changed member profiles, and group title edits.
 */
export function diffEventSnapshot(prev, next) {
  if (!prev || !next) {
    return {
      addedExpenseIds: [],
      addedSettlementIds: [],
      addedTimelineIds: [],
      addedFeedIds: [],
      titleChanged: false,
      updatedParticipants: [],
    };
  }

  const addedExpenseIds = findAddedIds(prev.expenseIds, next.expenseIds);
  const addedSettlementIds = findAddedIds(prev.settlementIds, next.settlementIds);
  const addedTimelineIds = findAddedIds(prev.timelineIds, next.timelineIds);
  const addedFeedIds = [...addedExpenseIds, ...addedSettlementIds, ...addedTimelineIds];

  const prevParticipantsById = new Map((prev.participants || []).map((p) => [p.id, p]));
  const updatedParticipants = [];
  for (const person of next.participants || []) {
    const previous = prevParticipantsById.get(person.id);
    if (!previous) continue;
    const nameChanged = previous.name !== person.name;
    const avatarChanged = (previous.avatar_version || null) !== (person.avatar_version || null);
    if (nameChanged || avatarChanged) {
      updatedParticipants.push({
        participantId: person.id,
        userId: person.user_id || null,
        nameChanged,
        avatarChanged,
      });
    }
  }

  return {
    addedExpenseIds,
    addedSettlementIds,
    addedTimelineIds,
    addedFeedIds,
    titleChanged: (prev.eventTitle || '') !== (next.eventTitle || ''),
    updatedParticipants,
  };
}

/**
 * Produces a deterministic signature of member avatar versions for lightweight change checks.
 */
export function buildAvatarSignature(participants = []) {
  return participants
    .filter((person) => person && person.user_id)
    .map((person) => `${person.user_id}:${person.avatar_version || ''}`)
    .sort()
    .join('|');
}

/**
 * Formats the floating jump-to-top counter pill above the sticky date divider.
 */
export function formatNewEntriesLabel(count) {
  const safeCount = Math.max(0, Math.floor(Number(count) || 0));
  if (safeCount === 0) return '';
  if (safeCount === 1) return '1 nova atualização';
  return `${safeCount} novas atualizações`;
}

/**
 * Computes bounded exponential backoff with symmetric jitter for SSE reconnection.
 */
export function computeReconnectDelayMs({
  attempt = 0,
  baseMs = 1500,
  maxMs = 30000,
  jitterRatio = 0.25,
  random = Math.random,
} = {}) {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const raw = Math.min(maxMs, baseMs * (2 ** safeAttempt));
  const spread = raw * Math.max(0, Math.min(0.5, jitterRatio));
  const offset = (random() * 2 - 1) * spread;
  return Math.max(300, Math.round(raw + offset));
}

/**
 * Incrementally parses Server-Sent Events (SSE) text chunks into structured events.
 */
export function createSseParser() {
  let buffer = '';
  let eventName = 'message';
  let dataLines = [];
  let eventId = null;

  function flushEvent(events) {
    if (!dataLines.length && eventName === 'message' && eventId === null) {
      return;
    }
    if (dataLines.length) {
      events.push({
        event: eventName || 'message',
        id: eventId,
        data: dataLines.join('\n'),
      });
    }
    eventName = 'message';
    dataLines = [];
    eventId = null;
  }

  function feed(chunk) {
    const events = [];
    if (typeof chunk !== 'string' || !chunk) return events;
    buffer += chunk;

    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }

      if (line === '') {
        flushEvent(events);
      } else if (line.startsWith(':')) {
        // Comment / keepalive ping line; ignore.
      } else {
        const colonIdx = line.indexOf(':');
        const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
        let value = colonIdx === -1 ? '' : line.slice(colonIdx + 1);
        if (value.startsWith(' ')) value = value.slice(1);

        if (field === 'event') {
          eventName = value || 'message';
        } else if (field === 'data') {
          dataLines.push(value);
        } else if (field === 'id') {
          eventId = value;
        }
      }

      newlineIndex = buffer.indexOf('\n');
    }

    return events;
  }

  return { feed };
}
