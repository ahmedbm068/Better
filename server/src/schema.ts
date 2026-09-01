/**
 * The server schema.
 *
 * Rows are stored generically — one table, keyed by user, sync table and wire
 * key, with the row itself as JSON. The server never asks a question about the
 * *contents* of a habit; it only ever looks a row up by key or streams
 * everything past a sequence number. Mirroring ten tables would buy nothing and
 * would mean a migration on both sides every time a column moved.
 *
 * `seq` is a per-user counter, not a timestamp. The pull cursor has to be
 * monotonic and clock-independent, which is exactly what `updated_at` is not.
 */
export const SCHEMA: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  -- The next sequence to hand out. Bumped once per accepted push.
  next_seq    INTEGER NOT NULL DEFAULT 1,
  -- Set once the starter habits and avoid list have been created, so a second
  -- device signing in does not seed a duplicate set.
  seeded      INTEGER NOT NULL DEFAULT 0
);
`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider ON users(provider, provider_id);`,
  `
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);`,
  `
-- Short-lived, single-use, and checked on the way back from the provider, so a
-- callback cannot be replayed or forged.
CREATE TABLE IF NOT EXISTS oauth_states (
  state      TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  -- Set when the handshake began in the desktop app, so the callback knows to
  -- send the browser back to the loopback port instead of to the web client.
  desktop    INTEGER NOT NULL DEFAULT 0
);
`,
  `
CREATE TABLE IF NOT EXISTS sync_rows (
  user_id    TEXT NOT NULL,
  tbl        TEXT NOT NULL,
  row_key    TEXT NOT NULL,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  seq        INTEGER NOT NULL,
  PRIMARY KEY (user_id, tbl, row_key)
);
`,
  `CREATE INDEX IF NOT EXISTS idx_rows_seq ON sync_rows(user_id, seq);`
]

/** The starter lists, created once per account rather than once per device. */
export const SEED_HABITS = [
  'Sport / training',
  'Read 20 minutes',
  'Talk to someone new / a real conversation with a human',
  'Work on a project',
  'Clean space before sleep',
  'Job applications'
]

export const SEED_AVOID: Array<{ name: string; quitTracker?: boolean }> = [
  { name: 'No cigarettes / nicotine', quitTracker: true },
  { name: 'No scrolling reels or short-form video' },
  { name: 'No video games' },
  { name: 'No sleeping past my target wake time' }
]
