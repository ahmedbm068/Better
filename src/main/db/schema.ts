/**
 * Schema migrations, applied in order and tracked with SQLite's `user_version`.
 * Never edit a shipped migration; append a new one.
 */
import type { DatabaseType } from './types'
import type { Millis } from '@shared/types'
import { uuidv7 } from '@shared/uid'

export interface Migration {
  version: number
  up: string
  /**
   * Data work that SQL alone cannot express, run inside the same transaction as
   * `up`. Used to mint identities, which need a generator rather than a default.
   */
  after?: (db: DatabaseType) => void
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: `
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Prayer times are snapshotted per day the first time that day is touched, so
-- changing coordinates or calculation method later can never rewrite history.
CREATE TABLE prayer_times (
  date        TEXT PRIMARY KEY,
  fajr        INTEGER NOT NULL,
  sunrise     INTEGER NOT NULL,
  dhuhr       INTEGER NOT NULL,
  asr         INTEGER NOT NULL,
  maghrib     INTEGER NOT NULL,
  isha        INTEGER NOT NULL,
  latitude    REAL    NOT NULL,
  longitude   REAL    NOT NULL,
  method      TEXT    NOT NULL,
  madhab      TEXT    NOT NULL,
  tz          TEXT    NOT NULL,
  computed_at INTEGER NOT NULL
);

-- A row exists only for a prayer checked off inside its own window. Absence of
-- a row plus a closed window is what "missed" means; there is nothing to write.
CREATE TABLE prayer_marks (
  date    TEXT    NOT NULL,
  prayer  TEXT    NOT NULL CHECK (prayer IN ('fajr','dhuhr','asr','maghrib','isha')),
  done_at INTEGER NOT NULL,
  PRIMARY KEY (date, prayer)
);

CREATE TABLE habits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  position   INTEGER NOT NULL,
  days_mask  INTEGER NOT NULL DEFAULT 127,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE habit_logs (
  habit_id   INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  date       TEXT    NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  grace      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (habit_id, date)
);
CREATE INDEX idx_habit_logs_date ON habit_logs(date);

CREATE TABLE avoid_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  position        INTEGER NOT NULL,
  archived        INTEGER NOT NULL DEFAULT 0,
  is_quit_tracker INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);

CREATE TABLE avoid_logs (
  item_id    INTEGER NOT NULL REFERENCES avoid_items(id) ON DELETE CASCADE,
  date       TEXT    NOT NULL,
  status     TEXT    NOT NULL CHECK (status IN ('clean','slip')),
  note       TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (item_id, date)
);
CREATE INDEX idx_avoid_logs_date ON avoid_logs(date);

CREATE TABLE work_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT    NOT NULL,
  project    TEXT    NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER,
  note       TEXT
);
CREATE INDEX idx_work_date ON work_sessions(date);
CREATE INDEX idx_work_started ON work_sessions(started_at);

CREATE TABLE sleep_sessions (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  date     TEXT    NOT NULL UNIQUE,
  sleep_at INTEGER,
  wake_at  INTEGER,
  note     TEXT
);

CREATE TABLE day_notes (
  date TEXT PRIMARY KEY,
  note TEXT NOT NULL
);

CREATE TABLE weekly_reviews (
  week_start TEXT PRIMARY KEY,
  note       TEXT    NOT NULL DEFAULT '',
  fix_next   TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Dedupes notifications across restarts, so a reminder fires once and only once.
CREATE TABLE notification_log (
  key     TEXT PRIMARY KEY,
  sent_at INTEGER NOT NULL
);
`
  },
  {
    version: 2,
    up: `
-- Sync identity. Local integer ids stay the primary key and every foreign key
-- keeps pointing at them, so nothing above the repositories changes. \`uid\` is
-- what crosses the wire, because two devices creating a habit while offline
-- would otherwise both call it id 7.
--
-- sleep_sessions is deliberately absent: its \`date\` is already UNIQUE and every
-- accessor addresses it by date, so it has a natural key and needs no uid.
ALTER TABLE habits        ADD COLUMN uid TEXT;
ALTER TABLE avoid_items   ADD COLUMN uid TEXT;
ALTER TABLE work_sessions ADD COLUMN uid TEXT;

CREATE UNIQUE INDEX idx_habits_uid       ON habits(uid);
CREATE UNIQUE INDEX idx_avoid_items_uid  ON avoid_items(uid);
CREATE UNIQUE INDEX idx_work_sessions_uid ON work_sessions(uid);

-- Last-write-wins needs a timestamp on every syncable row. habit_logs,
-- avoid_logs and weekly_reviews already carry one.
ALTER TABLE habits        ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE avoid_items   ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE work_sessions ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sleep_sessions ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE day_notes     ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE prayer_marks  ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

-- Tombstones. A delete becomes a write; a row removed outright would simply be
-- resurrected by the next pull from the other device.
ALTER TABLE habits         ADD COLUMN deleted_at INTEGER;
ALTER TABLE habit_logs     ADD COLUMN deleted_at INTEGER;
ALTER TABLE avoid_items    ADD COLUMN deleted_at INTEGER;
ALTER TABLE avoid_logs     ADD COLUMN deleted_at INTEGER;
ALTER TABLE work_sessions  ADD COLUMN deleted_at INTEGER;
ALTER TABLE sleep_sessions ADD COLUMN deleted_at INTEGER;
ALTER TABLE day_notes      ADD COLUMN deleted_at INTEGER;
ALTER TABLE weekly_reviews ADD COLUMN deleted_at INTEGER;
ALTER TABLE prayer_marks   ADD COLUMN deleted_at INTEGER;

-- Every read filters on these, and the sync push scans them.
CREATE INDEX idx_habits_sync         ON habits(updated_at);
CREATE INDEX idx_avoid_items_sync    ON avoid_items(updated_at);
CREATE INDEX idx_work_sessions_sync  ON work_sessions(updated_at);
CREATE INDEX idx_habit_logs_sync     ON habit_logs(updated_at);
CREATE INDEX idx_avoid_logs_sync     ON avoid_logs(updated_at);
CREATE INDEX idx_sleep_sessions_sync ON sleep_sessions(updated_at);
CREATE INDEX idx_day_notes_sync      ON day_notes(updated_at);
CREATE INDEX idx_weekly_reviews_sync ON weekly_reviews(updated_at);
CREATE INDEX idx_prayer_marks_sync   ON prayer_marks(updated_at);

-- The sync cursor and account binding. Kept apart from \`settings\` because none
-- of it is the user's preference and none of it belongs in a backup.
CREATE TABLE sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`,
    after: backfillSyncIdentity
  },
  {
    version: 3,
    up: `
-- Which rows still owe the server a push.
--
-- Set by trigger rather than by each write path on purpose: a repository added
-- later cannot forget to mark its writes, and forgetting would silently drop a
-- change rather than fail loudly.
--
-- Existing rows default to 1, so the first sync after signing in pushes
-- everything the device already has.
ALTER TABLE habits         ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
ALTER TABLE habit_logs     ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
ALTER TABLE avoid_items    ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
ALTER TABLE avoid_logs     ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
ALTER TABLE work_sessions  ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sleep_sessions ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
ALTER TABLE day_notes      ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
ALTER TABLE weekly_reviews ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
ALTER TABLE prayer_marks   ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
ALTER TABLE prayer_times   ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;

CREATE INDEX idx_habits_dirty         ON habits(dirty) WHERE dirty = 1;
CREATE INDEX idx_habit_logs_dirty     ON habit_logs(dirty) WHERE dirty = 1;
CREATE INDEX idx_avoid_items_dirty    ON avoid_items(dirty) WHERE dirty = 1;
CREATE INDEX idx_avoid_logs_dirty     ON avoid_logs(dirty) WHERE dirty = 1;
CREATE INDEX idx_work_sessions_dirty  ON work_sessions(dirty) WHERE dirty = 1;
CREATE INDEX idx_sleep_sessions_dirty ON sleep_sessions(dirty) WHERE dirty = 1;
CREATE INDEX idx_day_notes_dirty      ON day_notes(dirty) WHERE dirty = 1;
CREATE INDEX idx_weekly_reviews_dirty ON weekly_reviews(dirty) WHERE dirty = 1;
CREATE INDEX idx_prayer_marks_dirty   ON prayer_marks(dirty) WHERE dirty = 1;
CREATE INDEX idx_prayer_times_dirty   ON prayer_times(dirty) WHERE dirty = 1;

-- Every trigger below is muted while the sync layer itself is writing, by the
-- presence of a 'sync_muted' row in sync_state. Without it, applying a pull
-- would immediately mark the pulled rows as owing a push back, and clearing the
-- flag after a push would set it straight back to 1.
--
-- The inner UPDATE does not re-enter the trigger because recursive_triggers is
-- off, which is SQLite's default and is never turned on in openDatabase.
CREATE TRIGGER trg_habits_dirty AFTER UPDATE ON habits
WHEN NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'sync_muted')
BEGIN
  UPDATE habits SET dirty = 1 WHERE id = NEW.id;
END;

CREATE TRIGGER trg_habit_logs_dirty AFTER UPDATE ON habit_logs
WHEN NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'sync_muted')
BEGIN
  UPDATE habit_logs SET dirty = 1 WHERE habit_id = NEW.habit_id AND date = NEW.date;
END;

CREATE TRIGGER trg_avoid_items_dirty AFTER UPDATE ON avoid_items
WHEN NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'sync_muted')
BEGIN
  UPDATE avoid_items SET dirty = 1 WHERE id = NEW.id;
END;

CREATE TRIGGER trg_avoid_logs_dirty AFTER UPDATE ON avoid_logs
WHEN NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'sync_muted')
BEGIN
  UPDATE avoid_logs SET dirty = 1 WHERE item_id = NEW.item_id AND date = NEW.date;
END;

CREATE TRIGGER trg_work_sessions_dirty AFTER UPDATE ON work_sessions
WHEN NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'sync_muted')
BEGIN
  UPDATE work_sessions SET dirty = 1 WHERE id = NEW.id;
END;

CREATE TRIGGER trg_sleep_sessions_dirty AFTER UPDATE ON sleep_sessions
WHEN NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'sync_muted')
BEGIN
  UPDATE sleep_sessions SET dirty = 1 WHERE date = NEW.date;
END;

CREATE TRIGGER trg_day_notes_dirty AFTER UPDATE ON day_notes
WHEN NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'sync_muted')
BEGIN
  UPDATE day_notes SET dirty = 1 WHERE date = NEW.date;
END;

CREATE TRIGGER trg_weekly_reviews_dirty AFTER UPDATE ON weekly_reviews
WHEN NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'sync_muted')
BEGIN
  UPDATE weekly_reviews SET dirty = 1 WHERE week_start = NEW.week_start;
END;

CREATE TRIGGER trg_prayer_marks_dirty AFTER UPDATE ON prayer_marks
WHEN NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'sync_muted')
BEGIN
  UPDATE prayer_marks SET dirty = 1 WHERE date = NEW.date AND prayer = NEW.prayer;
END;

CREATE TRIGGER trg_prayer_times_dirty AFTER UPDATE ON prayer_times
WHEN NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'sync_muted')
BEGIN
  UPDATE prayer_times SET dirty = 1 WHERE date = NEW.date;
END;
`
  }
]

/**
 * Gives rows that predate sync the identity and timestamp it needs.
 *
 * Runs as migration 2's data step, and again after a restore: a backup written
 * before this schema has no `uid` column at all, and its rows would otherwise
 * arrive unsyncable.
 */
export function backfillSyncIdentity(db: DatabaseType, now: Millis = Date.now()): void {
  // The v7 timestamp is seeded from when the row was actually created, so ids
  // still sort by age rather than by the moment the backfill happened to run.
  const mint = (table: string, createdColumn: string): void => {
    const rows = db
      .prepare(`SELECT id, ${createdColumn} AS created FROM ${table} WHERE uid IS NULL`)
      .all() as Array<{ id: number; created: number | null }>
    const stmt = db.prepare(`UPDATE ${table} SET uid = ?, updated_at = ? WHERE id = ?`)
    for (const row of rows) {
      const created = row.created ?? now
      stmt.run(uuidv7(created), created, row.id)
    }
  }
  mint('habits', 'created_at')
  mint('avoid_items', 'created_at')
  mint('work_sessions', 'COALESCE(ended_at, started_at)')

  // A row left at updated_at = 0 would lose every merge it ever took part in.
  db.prepare('UPDATE prayer_marks SET updated_at = done_at WHERE updated_at = 0').run()
  db.prepare(
    'UPDATE sleep_sessions SET updated_at = COALESCE(wake_at, sleep_at, ?) WHERE updated_at = 0'
  ).run(now)
  for (const table of ['habits', 'avoid_items', 'work_sessions', 'day_notes'] as const) {
    db.prepare(`UPDATE ${table} SET updated_at = ? WHERE updated_at = 0`).run(now)
  }
}

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
