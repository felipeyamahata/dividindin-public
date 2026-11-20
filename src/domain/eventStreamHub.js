import { SSE_HEARTBEAT_INTERVAL_MS } from './eventSync.js';

export const DEFAULT_MAX_SSE_CONNECTIONS = 500;
export const DEFAULT_MAX_SSE_PER_USER = 6;
export const DEFAULT_SSE_MAX_RSS_BYTES = 325 * 1024 * 1024;

function formatSseFrame(eventName, payload) {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Bounded in-memory SSE hub routing real-time event/profile sync notifications
 * to active visible tabs without polling or SQLite writes.
 */
export function createEventStreamHub({
  maxConnections = DEFAULT_MAX_SSE_CONNECTIONS,
  maxPerUser = DEFAULT_MAX_SSE_PER_USER,
  maxRssBytes = DEFAULT_SSE_MAX_RSS_BYTES,
  heartbeatIntervalMs = SSE_HEARTBEAT_INTERVAL_MS,
  getRssBytes = () => process.memoryUsage().rss,
} = {}) {
  const byEvent = new Map();
  const byUser = new Map();
  const allClients = new Set();
  let heartbeatTimer = null;

  function ensureHeartbeat() {
    if (heartbeatTimer || heartbeatIntervalMs <= 0 || allClients.size === 0) return;
    heartbeatTimer = setInterval(() => {
      for (const client of Array.from(allClients)) {
        try {
          client.write(': ping\n\n');
        } catch {
          client.unsubscribe();
        }
      }
    }, heartbeatIntervalMs);
    if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
  }

  function stopHeartbeatIfIdle() {
    if (heartbeatTimer && allClients.size === 0) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function addToIndex(indexMap, key, client) {
    if (!key) return;
    let set = indexMap.get(key);
    if (!set) {
      set = new Set();
      indexMap.set(key, set);
    }
    set.add(client);
  }

  function removeFromIndex(indexMap, key, client) {
    if (!key) return;
    const set = indexMap.get(key);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) indexMap.delete(key);
  }

  function subscribe({ eventId = null, userId = null, write, close } = {}) {
    if (typeof write !== 'function') {
      return { ok: false, reason: 'invalid-writer' };
    }

    const rssBytes = Number(getRssBytes() || 0);
    if (rssBytes >= maxRssBytes) {
      return { ok: false, reason: 'high-memory' };
    }

    if (allClients.size >= maxConnections) {
      return { ok: false, reason: 'max-connections' };
    }

    if (userId) {
      const userSet = byUser.get(userId);
      if (userSet && userSet.size >= maxPerUser) {
        // Evict oldest connection for this user (e.g., stale mobile tab before reload)
        const oldest = userSet.values().next().value;
        oldest?.unsubscribe({ closeStream: true });
      }
    }

    let active = true;
    const client = {
      eventId,
      userId,
      write,
      unsubscribe({ closeStream = false } = {}) {
        if (!active) return;
        active = false;
        allClients.delete(client);
        removeFromIndex(byEvent, eventId, client);
        removeFromIndex(byUser, userId, client);
        stopHeartbeatIfIdle();
        if (closeStream && typeof close === 'function') {
          try {
            close();
          } catch {
            // Stream already closed.
          }
        }
      },
    };

    allClients.add(client);
    addToIndex(byEvent, eventId, client);
    addToIndex(byUser, userId, client);
    ensureHeartbeat();

    return {
      ok: true,
      unsubscribe: () => client.unsubscribe(),
    };
  }

  function sendToClients(clients, eventName, payload) {
    if (!clients || clients.size === 0) return 0;
    const frame = formatSseFrame(eventName, payload);
    let delivered = 0;
    for (const client of Array.from(clients)) {
      try {
        client.write(frame);
        delivered += 1;
      } catch {
        client.unsubscribe({ closeStream: true });
      }
    }
    return delivered;
  }

  function publishEvent(eventId, { reason = 'updated', ...extra } = {}) {
    if (!eventId) return 0;
    const payload = { eventId, reason, ts: Date.now(), ...extra };
    return sendToClients(byEvent.get(eventId), 'sync', payload);
  }

  function publishToUsers(userIds = [], payload = {}) {
    let delivered = 0;
    const seenClients = new Set();
    const frame = formatSseFrame('sync', { ts: Date.now(), ...payload });
    for (const userId of userIds) {
      const clients = byUser.get(userId);
      if (!clients) continue;
      for (const client of Array.from(clients)) {
        if (seenClients.has(client)) continue;
        seenClients.add(client);
        try {
          client.write(frame);
          delivered += 1;
        } catch {
          client.unsubscribe({ closeStream: true });
        }
      }
    }
    return delivered;
  }

  /**
   * Notifies both active event subscribers and home-list subscribers for all members of an event.
   */
  function notifyEventChanged(db, eventId, { reason = 'updated', ...extra } = {}) {
    if (!eventId) return 0;
    const payload = { eventId, reason, ts: Date.now(), ...extra };
    const deliveredToEvent = sendToClients(byEvent.get(eventId), 'sync', payload);

    let memberUserIds = [];
    if (db) {
      try {
        const rows = db.prepare(`
          SELECT DISTINCT user_id FROM participants WHERE event_id = ? AND user_id IS NOT NULL
          UNION
          SELECT created_by AS user_id FROM events WHERE id = ? AND created_by IS NOT NULL
        `).all(eventId, eventId);
        memberUserIds = rows.map((row) => row.user_id).filter(Boolean);
      } catch {
        memberUserIds = [];
      }
    }

    // Notify home-list listeners (clients subscribed without a specific eventId)
    let deliveredToHome = 0;
    if (memberUserIds.length) {
      const frame = formatSseFrame('sync', payload);
      for (const userId of memberUserIds) {
        const clients = byUser.get(userId);
        if (!clients) continue;
        for (const client of Array.from(clients)) {
          if (client.eventId) continue;
          try {
            client.write(frame);
            deliveredToHome += 1;
          } catch {
            client.unsubscribe({ closeStream: true });
          }
        }
      }
    }

    return deliveredToEvent + deliveredToHome;
  }

  /**
   * Updates event_activity and notifies all events belonging to a user (e.g. avatar or display name change).
   */
  function notifyUserProfileChanged(db, userId, { reason = 'profile' } = {}) {
    if (!db || !userId) return 0;
    let eventIds = [];
    try {
      const rows = db.prepare(`
        SELECT DISTINCT event_id FROM participants WHERE user_id = ?
        UNION
        SELECT id AS event_id FROM events WHERE created_by = ?
      `).all(userId, userId);
      eventIds = rows.map((row) => row.event_id).filter(Boolean);

      if (eventIds.length) {
        const touchStmt = db.prepare(`
          INSERT INTO event_activity (event_id, updated_at)
          VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ON CONFLICT(event_id) DO UPDATE SET updated_at = excluded.updated_at
        `);
        for (const eventId of eventIds) {
          touchStmt.run(eventId);
        }
      }
    } catch {
      // Non-critical activity bump.
    }

    let delivered = 0;
    for (const eventId of eventIds) {
      delivered += notifyEventChanged(db, eventId, { reason, userId });
    }
    return delivered;
  }

  function stats() {
    return {
      activeConnections: allClients.size,
      activeEvents: byEvent.size,
      activeUsers: byUser.size,
    };
  }

  function clear() {
    for (const client of Array.from(allClients)) {
      client.unsubscribe({ closeStream: true });
    }
    stopHeartbeatIfIdle();
  }

  return {
    subscribe,
    publishEvent,
    publishToUsers,
    notifyEventChanged,
    notifyUserProfileChanged,
    stats,
    clear,
  };
}

export const eventStreamHub = createEventStreamHub();
