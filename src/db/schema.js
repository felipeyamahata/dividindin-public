export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      client_mode TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS user_avatars (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      version TEXT NOT NULL,
      image TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_oauth_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(provider, provider_user_id)
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL COLLATE NOCASE,
      title TEXT NOT NULL,
      description TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      user_id TEXT,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL,
      join_source TEXT,
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      description TEXT NOT NULL,
      amount INTEGER NOT NULL,
      payer_id TEXT NOT NULL,
      split_mode TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY(payer_id) REFERENCES participants(id) ON DELETE CASCADE,
      FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS expense_splits (
      id TEXT PRIMARY KEY,
      expense_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      allocated_amount INTEGER,
      percentage REAL,
      shares REAL,
      FOREIGN KEY(expense_id) REFERENCES expenses(id) ON DELETE CASCADE,
      FOREIGN KEY(participant_id) REFERENCES participants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settlements (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      from_participant_id TEXT NOT NULL,
      to_participant_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      debt_before INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT,
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY(from_participant_id) REFERENCES participants(id) ON DELETE CASCADE,
      FOREIGN KEY(to_participant_id) REFERENCES participants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS event_activity (
      event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS event_timeline_events (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      actor_name TEXT NOT NULL,
      participant_id TEXT REFERENCES participants(id) ON DELETE SET NULL,
      placeholder_name TEXT,
      placeholder_color TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      user_id TEXT,
      event_id TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sustainability_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      pix_key TEXT NOT NULL DEFAULT '',
      merchant_name TEXT NOT NULL DEFAULT 'YAMAHATA LAB',
      merchant_city TEXT NOT NULL DEFAULT 'SAO PAULO',
      usd_brl_fallback REAL NOT NULL DEFAULT 5.8,
      usd_brl_cached REAL,
      usd_brl_cached_at TEXT,
      use_auto_usd INTEGER NOT NULL DEFAULT 1,
      intro_text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sustainability_costs (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'BRL',
      billing_cycle TEXT NOT NULL DEFAULT 'monthly',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sustainability_donations (
      id TEXT PRIMARY KEY,
      month_key TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      provider TEXT NOT NULL DEFAULT 'manual',
      provider_payment_id TEXT,
      expires_at TEXT,
      note TEXT,
      confirmed_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_participants_event ON participants(event_id);
    CREATE INDEX IF NOT EXISTS idx_participants_user ON participants(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_oauth_user ON user_oauth_accounts(user_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_event ON expenses(event_id);
    CREATE INDEX IF NOT EXISTS idx_settlements_event ON settlements(event_id);
    CREATE INDEX IF NOT EXISTS idx_splits_expense ON expense_splits(expense_id);
    CREATE INDEX IF NOT EXISTS idx_timeline_event ON event_timeline_events(event_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_logs_type ON activity_logs(event_type);
    CREATE INDEX IF NOT EXISTS idx_sustainability_donations_month ON sustainability_donations(month_key, status);
  `);

  // Historical activity is limited to timestamps that were retained before this migration.
  db.exec(`
    INSERT OR IGNORE INTO event_activity (event_id, updated_at)
    SELECT e.id, max(e.created_at,
      COALESCE((SELECT max(created_at) FROM expenses WHERE event_id = e.id), e.created_at),
      COALESCE((SELECT max(created_at) FROM settlements WHERE event_id = e.id), e.created_at),
      COALESCE((SELECT max(created_at) FROM participants WHERE event_id = e.id), e.created_at))
    FROM events e;
  `);
  for (const table of ['participants', 'expenses', 'settlements', 'event_timeline_events']) {
    for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
      const row = operation === 'DELETE' ? 'OLD' : 'NEW';
      db.exec(`CREATE TRIGGER IF NOT EXISTS activity_${table}_${operation.toLowerCase()}
        AFTER ${operation} ON ${table}
        WHEN EXISTS (SELECT 1 FROM events WHERE id = ${row}.event_id)
        BEGIN
          INSERT INTO event_activity (event_id, updated_at)
          VALUES (${row}.event_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ON CONFLICT(event_id) DO UPDATE SET updated_at = excluded.updated_at;
        END;`);
    }
  }

  // Safe migrations for existing DBs
  const columnMigrations = [
    'ALTER TABLE expense_splits ADD COLUMN shares REAL;',
    'ALTER TABLE users ADD COLUMN last_seen_at TEXT;',
    'ALTER TABLE sessions ADD COLUMN client_mode TEXT;',
    'ALTER TABLE sessions ADD COLUMN created_at TEXT;',
    'ALTER TABLE participants ADD COLUMN join_source TEXT;',
    'ALTER TABLE settlements ADD COLUMN created_by TEXT;',
    'ALTER TABLE settlements ADD COLUMN debt_before INTEGER;',
    "ALTER TABLE sustainability_donations ADD COLUMN provider TEXT NOT NULL DEFAULT 'manual';",
    'ALTER TABLE sustainability_donations ADD COLUMN provider_payment_id TEXT;',
    'ALTER TABLE sustainability_donations ADD COLUMN expires_at TEXT;',
  ];

  for (const statement of columnMigrations) {
    try {
      db.exec(statement);
    } catch {
      // Column already exists
    }
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sustainability_donations_provider_payment
    ON sustainability_donations(provider, provider_payment_id)
    WHERE provider_payment_id IS NOT NULL;
  `);
}
