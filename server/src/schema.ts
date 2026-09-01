/**
 * The server schema, as ordered migrations.
 *
 * Rows are stored generically — one table, keyed by user, sync table and wire
 * key, with the row itself as JSON. The server never asks a question about the
 * *contents* of a habit; it only ever looks a row up by key or streams
 * everything past a sequence number.
 *
 * `seq` is a per-user counter, not a timestamp. The pull cursor has to be
 * monotonic and clock-independent, which is exactly what `updated_at` is not.
 *
 * Never edit a shipped migration; append a new one. The applied version lives
 * in `schema_meta`, since D1 offers no dependable access to `user_version`.
 */
export interface ServerMigration {
  version: number
  statements: readonly string[]
}

export const MIGRATIONS: readonly ServerMigration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS users (
        id          TEXT PRIMARY KEY,
        provider    TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        next_seq    INTEGER NOT NULL DEFAULT 1,
        seeded      INTEGER NOT NULL DEFAULT 0
      );`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider ON users(provider, provider_id);`,
      `CREATE TABLE IF NOT EXISTS sessions (
        token      TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);`,
      `CREATE TABLE IF NOT EXISTS oauth_states (
        state      TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        desktop    INTEGER NOT NULL DEFAULT 0
      );`,
      `CREATE TABLE IF NOT EXISTS sync_rows (
        user_id    TEXT NOT NULL,
        tbl        TEXT NOT NULL,
        row_key    TEXT NOT NULL,
        data       TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        seq        INTEGER NOT NULL,
        PRIMARY KEY (user_id, tbl, row_key)
      );`,
      `CREATE INDEX IF NOT EXISTS idx_rows_seq ON sync_rows(user_id, seq);`
    ]
  },
  {
    version: 2,
    statements: [
      // An account is now a person, identified by a verified email address,
      // rather than one login at one provider. Signing in with Google and later
      // with GitHub on the same address has to reach the same data, not two
      // half-accounts holding half a history each.
      `CREATE TABLE identities (
        provider    TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (provider, provider_id)
      );`,
      `INSERT INTO identities (provider, provider_id, user_id, created_at)
         SELECT provider, provider_id, id, created_at FROM users;`,

      // Rebuilt rather than altered: the provider columns move out and the
      // email and password fields come in, which SQLite cannot do piecemeal.
      `CREATE TABLE users_new (
        id            TEXT PRIMARY KEY,
        email         TEXT,
        created_at    INTEGER NOT NULL,
        next_seq      INTEGER NOT NULL DEFAULT 1,
        seeded        INTEGER NOT NULL DEFAULT 0,
        -- PBKDF2. The iteration count is stored per row so it can be raised
        -- later without invalidating passwords set under the old one.
        password_hash TEXT,
        password_salt TEXT,
        password_iter INTEGER,
        -- Brute force is a risk the provider-only version did not have.
        failed_logins INTEGER NOT NULL DEFAULT 0,
        locked_until  INTEGER
      );`,
      `INSERT INTO users_new (id, created_at, next_seq, seeded)
         SELECT id, created_at, next_seq, seeded FROM users;`,
      `DROP TABLE users;`,
      `ALTER TABLE users_new RENAME TO users;`,
      // Case-folded, so Ahmed@x.com and ahmed@x.com are one account. Partial,
      // so accounts predating email collection do not all collide on NULL.
      `CREATE UNIQUE INDEX idx_users_email ON users(lower(email)) WHERE email IS NOT NULL;`,
      `CREATE INDEX idx_identities_user ON identities(user_id);`
    ]
  }
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
