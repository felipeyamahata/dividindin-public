const SPLIT_MODES = ['EQUAL_ALL', 'SUBSET_EQUAL', 'EXACT_AMOUNTS', 'PERCENTAGES', 'SHARES'];
const JOIN_SOURCES = ['creator', 'join', 'claim', 'placeholder'];

function formatLocalDateKey(dateInput, timeZone = 'America/Sao_Paulo') {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function buildDateBuckets(days, now, timeZone) {
  const buckets = [];
  const byDate = new Map();
  const baseMs = now.getTime();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(baseMs - i * 24 * 60 * 60 * 1000);
    const key = formatLocalDateKey(d, timeZone);
    if (!byDate.has(key)) {
      const entry = {
        date: key,
        newUsers: 0,
        logins: 0,
        loginFailures: 0,
        eventsCreated: 0,
        expensesCreated: 0,
        expenseVolumeCents: 0,
        settlementsCreated: 0,
      };
      byDate.set(key, entry);
      buckets.push(entry);
    }
  }
  return { buckets, byDate };
}

function parseMetadata(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

/**
 * Computes product, retention, and operational metrics from a SQLite database handle.
 * Works safely against read-only connections.
 */
export function getDashboardMetrics(db, {
  days = 14,
  logLimit = 60,
  logType = '',
  timeZone = 'America/Sao_Paulo',
  now = new Date(),
} = {}) {
  const periodDays = Math.min(90, Math.max(1, Number.isFinite(Number(days)) ? Math.round(Number(days)) : 14));
  const safeLimit = Math.min(200, Math.max(1, Number.isFinite(Number(logLimit)) ? Math.round(Number(logLimit)) : 60));
  const nowMs = now.getTime();
  const cutoffIso = new Date(nowMs - periodDays * 24 * 60 * 60 * 1000).toISOString();
  const cutoff5mIso = new Date(nowMs - 5 * 60 * 1000).toISOString();
  const cutoff60mIso = new Date(nowMs - 60 * 60 * 1000).toISOString();
  const cutoff24hIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const cutoff7dIso = new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString();
  // Buffer 1 extra day in SQL filter so timezone conversion into local days never clips boundary rows
  const seriesBufferIso = new Date(nowMs - (periodDays + 1) * 24 * 60 * 60 * 1000).toISOString();

  const userStats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_in_period,
      SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END) AS active_24h,
      SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END) AS active_7d,
      SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END) AS active_in_period
    FROM users
  `).get(cutoffIso, cutoff24hIso, cutoff7dIso, cutoffIso);

  const avatarRow = db.prepare('SELECT COUNT(*) AS count FROM user_avatars').get();

  const userActivation = db.prepare(`
    SELECT
      COUNT(DISTINCT user_id) AS activated_users,
      SUM(CASE WHEN event_count >= 2 THEN 1 ELSE 0 END) AS returning_multi_event
    FROM (
      SELECT user_id, COUNT(DISTINCT event_id) AS event_count
      FROM participants
      WHERE user_id IS NOT NULL
      GROUP BY user_id
    )
  `).get();

  const sessionStats = db.prepare(`
    SELECT
      COUNT(*) AS active_total,
      SUM(CASE WHEN client_mode = 'pwa' THEN 1 ELSE 0 END) AS pwa,
      SUM(CASE WHEN client_mode = 'browser' THEN 1 ELSE 0 END) AS browser,
      SUM(CASE WHEN client_mode IS NULL THEN 1 ELSE 0 END) AS unknown
    FROM sessions
    WHERE expires_at > ?
  `).get(nowMs);

  const eventStats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN e.created_at >= ? THEN 1 ELSE 0 END) AS created_in_period,
      SUM(CASE WHEN COALESCE(a.updated_at, e.created_at) >= ? THEN 1 ELSE 0 END) AS active_in_period,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM expenses ex WHERE ex.event_id = e.id) THEN 1 ELSE 0 END) AS with_expenses,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM settlements st WHERE st.event_id = e.id) THEN 1 ELSE 0 END) AS with_settlements
    FROM events e
    LEFT JOIN event_activity a ON a.event_id = e.id
  `).get(cutoffIso, cutoffIso);

  const participantStats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) AS linked,
      SUM(CASE WHEN user_id IS NULL THEN 1 ELSE 0 END) AS unclaimed
    FROM participants
  `).get();

  const joinSourceRows = db.prepare(`
    SELECT COALESCE(join_source, 'unknown') AS source, COUNT(*) AS count
    FROM participants
    GROUP BY COALESCE(join_source, 'unknown')
  `).all();
  const byJoinSource = { creator: 0, join: 0, claim: 0, placeholder: 0, unknown: 0 };
  for (const row of joinSourceRows) {
    if (JOIN_SOURCES.includes(row.source)) {
      byJoinSource[row.source] = Number(row.count || 0);
    } else {
      byJoinSource.unknown += Number(row.count || 0);
    }
  }

  const expenseStats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS in_period,
      COALESCE(SUM(amount), 0) AS total_amount_cents,
      COALESCE(SUM(CASE WHEN created_at >= ? THEN amount ELSE 0 END), 0) AS amount_in_period_cents
    FROM expenses
  `).get(cutoffIso, cutoffIso);

  const splitModeRows = db.prepare(`
    SELECT split_mode, COUNT(*) AS count
    FROM expenses
    GROUP BY split_mode
  `).all();
  const bySplitMode = Object.fromEntries(SPLIT_MODES.map((m) => [m, 0]));
  for (const row of splitModeRows) {
    bySplitMode[row.split_mode] = Number(row.count || 0);
  }

  const settlementStats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS in_period,
      COALESCE(SUM(amount), 0) AS total_amount_cents,
      COALESCE(SUM(CASE WHEN created_at >= ? THEN amount ELSE 0 END), 0) AS amount_in_period_cents,
      SUM(CASE WHEN notes IS NOT NULL AND TRIM(notes) != '' THEN 1 ELSE 0 END) AS with_notes
    FROM settlements
  `).get(cutoffIso, cutoffIso);

  const { buckets, byDate } = buildDateBuckets(periodDays, now, timeZone);

  for (const row of db.prepare('SELECT created_at FROM users WHERE created_at >= ?').all(seriesBufferIso)) {
    const key = formatLocalDateKey(row.created_at, timeZone);
    if (byDate.has(key)) byDate.get(key).newUsers += 1;
  }
  for (const row of db.prepare('SELECT created_at FROM events WHERE created_at >= ?').all(seriesBufferIso)) {
    const key = formatLocalDateKey(row.created_at, timeZone);
    if (byDate.has(key)) byDate.get(key).eventsCreated += 1;
  }
  for (const row of db.prepare('SELECT created_at, amount FROM expenses WHERE created_at >= ?').all(seriesBufferIso)) {
    const key = formatLocalDateKey(row.created_at, timeZone);
    if (byDate.has(key)) {
      const bucket = byDate.get(key);
      bucket.expensesCreated += 1;
      bucket.expenseVolumeCents += Number(row.amount || 0);
    }
  }
  for (const row of db.prepare('SELECT created_at FROM settlements WHERE created_at >= ?').all(seriesBufferIso)) {
    const key = formatLocalDateKey(row.created_at, timeZone);
    if (byDate.has(key)) byDate.get(key).settlementsCreated += 1;
  }
  for (const row of db.prepare(
    "SELECT event_type, created_at FROM activity_logs WHERE created_at >= ? AND event_type IN ('login_success', 'user_registered', 'login_failed')",
  ).all(seriesBufferIso)) {
    const key = formatLocalDateKey(row.created_at, timeZone);
    if (!byDate.has(key)) continue;
    if (row.event_type === 'login_failed') {
      byDate.get(key).loginFailures += 1;
    } else {
      byDate.get(key).logins += 1;
    }
  }

  const logCountsRows = db.prepare(`
    SELECT event_type, COUNT(*) AS count
    FROM activity_logs
    WHERE created_at >= ?
    GROUP BY event_type
    ORDER BY count DESC, event_type ASC
  `).all(cutoffIso);
  const logCountsInPeriod = Object.fromEntries(logCountsRows.map((r) => [r.event_type, Number(r.count || 0)]));

  const normalizedLogType = typeof logType === 'string' ? logType.trim() : '';
  const logsQuery = normalizedLogType
    ? `
      SELECT l.id, l.event_type, l.user_id, l.event_id, l.metadata, l.created_at,
        u.username AS user_username, u.name AS user_name, e.title AS event_title
      FROM activity_logs l
      LEFT JOIN users u ON u.id = l.user_id
      LEFT JOIN events e ON e.id = l.event_id
      WHERE l.event_type = ?
      ORDER BY l.id DESC
      LIMIT ?
    `
    : `
      SELECT l.id, l.event_type, l.user_id, l.event_id, l.metadata, l.created_at,
        u.username AS user_username, u.name AS user_name, e.title AS event_title
      FROM activity_logs l
      LEFT JOIN users u ON u.id = l.user_id
      LEFT JOIN events e ON e.id = l.event_id
      ORDER BY l.id DESC
      LIMIT ?
    `;
  const rawLogs = normalizedLogType
    ? db.prepare(logsQuery).all(normalizedLogType, safeLimit)
    : db.prepare(logsQuery).all(safeLimit);

  const recentLogs = rawLogs.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    userId: row.user_id,
    username: row.user_username || null,
    userName: row.user_name || null,
    eventId: row.event_id,
    eventTitle: row.event_title || null,
    metadata: parseMetadata(row.metadata),
    createdAt: row.created_at,
  }));

  const topEvents = db.prepare(`
    SELECT
      e.id,
      e.title,
      e.created_at,
      COALESCE(a.updated_at, e.created_at) AS updated_at,
      (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id) AS participant_count,
      (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id AND p.user_id IS NOT NULL) AS claimed_count,
      (SELECT COUNT(*) FROM expenses ex WHERE ex.event_id = e.id) AS expense_count,
      (SELECT COALESCE(SUM(ex.amount), 0) FROM expenses ex WHERE ex.event_id = e.id) AS total_expenses_cents,
      (SELECT COUNT(*) FROM settlements st WHERE st.event_id = e.id) AS settlement_count
    FROM events e
    LEFT JOIN event_activity a ON a.event_id = e.id
    ORDER BY updated_at DESC, e.created_at DESC
    LIMIT 10
  `).all().map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    participantCount: Number(row.participant_count || 0),
    claimedCount: Number(row.claimed_count || 0),
    expenseCount: Number(row.expense_count || 0),
    totalExpensesCents: Number(row.total_expenses_cents || 0),
    settlementCount: Number(row.settlement_count || 0),
  }));

  const totalEvents = Number(eventStats?.total || 0);
  const totalParticipants = Number(participantStats?.total || 0);
  const totalExpenses = Number(expenseStats?.total || 0);
  const totalAmountCents = Number(expenseStats?.total_amount_cents || 0);

  const recent5mUsers = db.prepare(`
    SELECT
      l.user_id AS user_id,
      u.username AS username,
      u.name AS name,
      MAX(l.created_at) AS last_active_at,
      (
        SELECT l2.event_type
        FROM activity_logs l2
        WHERE l2.user_id = l.user_id AND l2.created_at >= ?
        ORDER BY l2.id DESC
        LIMIT 1
      ) AS last_event_type
    FROM activity_logs l
    LEFT JOIN users u ON u.id = l.user_id
    WHERE l.user_id IS NOT NULL AND l.created_at >= ?
    GROUP BY l.user_id
    ORDER BY last_active_at DESC
    LIMIT 100
  `).all(cutoff5mIso, cutoff5mIso).map((row) => ({
    userId: row.user_id,
    username: row.username || null,
    name: row.name || null,
    clientMode: null,
    lastEventType: row.last_event_type || null,
    lastActiveAt: row.last_active_at,
  }));

  const recent60mRow = db.prepare(`
    SELECT COUNT(DISTINCT user_id) AS count
    FROM activity_logs
    WHERE user_id IS NOT NULL AND created_at >= ?
  `).get(cutoff60mIso);

  const usersOverview = db.prepare(`
    SELECT
      u.id,
      u.username,
      u.name,
      u.created_at,
      u.last_seen_at,
      CASE WHEN a.user_id IS NOT NULL THEN 1 ELSE 0 END AS has_avatar,
      (SELECT COUNT(DISTINCT p.event_id) FROM participants p WHERE p.user_id = u.id) AS event_count,
      (SELECT COUNT(*) FROM expenses ex WHERE ex.created_by = u.id) AS expense_count,
      (SELECT COALESCE(SUM(ex.amount), 0) FROM expenses ex WHERE ex.created_by = u.id) AS total_created_cents
    FROM users u
    LEFT JOIN user_avatars a ON a.user_id = u.id
    ORDER BY COALESCE(u.last_seen_at, u.created_at) DESC, u.created_at DESC
    LIMIT 50
  `).all().map((row) => ({
    id: row.id,
    username: row.username,
    name: row.name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at || null,
    hasAvatar: Boolean(row.has_avatar),
    eventCount: Number(row.event_count || 0),
    expenseCount: Number(row.expense_count || 0),
    totalCreatedCents: Number(row.total_created_cents || 0),
  }));

  return {
    generatedAt: now.toISOString(),
    periodDays,
    users: {
      total: Number(userStats?.total || 0),
      newInPeriod: Number(userStats?.new_in_period || 0),
      active24h: Number(userStats?.active_24h || 0),
      active7d: Number(userStats?.active_7d || 0),
      activeInPeriod: Number(userStats?.active_in_period || 0),
      withAvatar: Number(avatarRow?.count || 0),
      activated: Number(userActivation?.activated_users || 0),
      returningMultiEvent: Number(userActivation?.returning_multi_event || 0),
    },
    sessions: {
      activeTotal: Number(sessionStats?.active_total || 0),
      pwa: Number(sessionStats?.pwa || 0),
      browser: Number(sessionStats?.browser || 0),
      unknown: Number(sessionStats?.unknown || 0),
    },
    events: {
      total: totalEvents,
      createdInPeriod: Number(eventStats?.created_in_period || 0),
      activeInPeriod: Number(eventStats?.active_in_period || 0),
      withExpenses: Number(eventStats?.with_expenses || 0),
      withSettlements: Number(eventStats?.with_settlements || 0),
      avgParticipants: totalEvents ? Number((totalParticipants / totalEvents).toFixed(1)) : 0,
    },
    participants: {
      total: totalParticipants,
      linked: Number(participantStats?.linked || 0),
      unclaimed: Number(participantStats?.unclaimed || 0),
      byJoinSource,
    },
    expenses: {
      total: totalExpenses,
      inPeriod: Number(expenseStats?.in_period || 0),
      totalAmountCents,
      amountInPeriodCents: Number(expenseStats?.amount_in_period_cents || 0),
      avgAmountCents: totalExpenses ? Math.round(totalAmountCents / totalExpenses) : 0,
      bySplitMode,
    },
    settlements: {
      total: Number(settlementStats?.total || 0),
      inPeriod: Number(settlementStats?.in_period || 0),
      totalAmountCents: Number(settlementStats?.total_amount_cents || 0),
      amountInPeriodCents: Number(settlementStats?.amount_in_period_cents || 0),
      withNotes: Number(settlementStats?.with_notes || 0),
    },
    dailySeries: buckets,
    logCountsInPeriod,
    recentLogs,
    topEvents,
    presenceFallback: {
      source: 'activity-logs',
      windowMinutes: 5,
      count: recent5mUsers.length,
      recent60mCount: Number(recent60mRow?.count || 0),
      users: recent5mUsers,
    },
    usersOverview,
  };
}
