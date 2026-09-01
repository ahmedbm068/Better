/**
 * The local half of sync: what this device owes the server, and how to fold in
 * what the server sends back. No network here — that belongs to the service
 * layer, so every merge rule in this file can be tested without one.
 *
 * Two translations happen at this boundary, and only here:
 *
 *  - Local integer ids never travel. A row goes out keyed by `uid` or by the
 *    natural key it already had, and a foreign key goes out as the parent uid.
 *  - Incoming rows are resolved back to local ids before they touch a table.
 *
 * Everything written by this module runs muted, so the dirty triggers do not
 * mark pulled rows as owing a push straight back.
 */
import type { DatabaseType } from './types'
import type { ChangeSet, SyncRow, SyncRows, SyncTable, SyncTableSpec } from '@shared/sync'
import { SYNC_TABLES, SYNC_TABLE_BY_NAME, incomingWins } from '@shared/sync'
import { getDb } from './handle'

/** Tables whose rows point at a parent, and the columns that pairing uses. */
const PARENT: Partial<
  Record<SyncTable, { wireColumn: string; localColumn: string; parentTable: string }>
> = {
  habit_logs: { wireColumn: 'habit_uid', localColumn: 'habit_id', parentTable: 'habits' },
  avoid_logs: { wireColumn: 'item_uid', localColumn: 'item_id', parentTable: 'avoid_items' }
}

/**
 * How each table produces the rows it owes.
 *
 * Written out rather than generated: the two joins differ from the rest, and a
 * query that decides what leaves the device is worth being able to read.
 *
 * The joins deliberately ignore whether the parent is tombstoned. A deleted
 * habit still has to carry its logs across, or the other device would keep them.
 */
const PENDING_SQL: Record<SyncTable, string> = {
  habits: `SELECT uid, name, position, days_mask, archived, created_at, updated_at, deleted_at
           FROM habits WHERE dirty = 1`,
  habit_logs: `SELECT h.uid AS habit_uid, l.date, l.done, l.grace, l.updated_at, l.deleted_at
               FROM habit_logs l JOIN habits h ON h.id = l.habit_id
               WHERE l.dirty = 1`,
  avoid_items: `SELECT uid, name, position, archived, is_quit_tracker, created_at, updated_at, deleted_at
                FROM avoid_items WHERE dirty = 1`,
  avoid_logs: `SELECT a.uid AS item_uid, l.date, l.status, l.note, l.updated_at, l.deleted_at
               FROM avoid_logs l JOIN avoid_items a ON a.id = l.item_id
               WHERE l.dirty = 1`,
  work_sessions: `SELECT uid, date, project, started_at, ended_at, note, updated_at, deleted_at
                  FROM work_sessions WHERE dirty = 1`,
  sleep_sessions: `SELECT date, sleep_at, wake_at, note, updated_at, deleted_at
                   FROM sleep_sessions WHERE dirty = 1`,
  day_notes: `SELECT date, note, updated_at, deleted_at FROM day_notes WHERE dirty = 1`,
  weekly_reviews: `SELECT week_start, note, fix_next, created_at, updated_at, deleted_at
                   FROM weekly_reviews WHERE dirty = 1`,
  prayer_marks: `SELECT date, prayer, done_at, updated_at, deleted_at
                 FROM prayer_marks WHERE dirty = 1`,
  prayer_times: `SELECT date, fajr, sunrise, dhuhr, asr, maghrib, isha, latitude, longitude,
                        method, madhab, tz, computed_at
                 FROM prayer_times WHERE dirty = 1`
}

/** The local column a wire column maps to. Only foreign keys differ. */
function localColumn(spec: SyncTableSpec, column: string): string {
  const parent = PARENT[spec.table]
  return parent && column === parent.wireColumn ? parent.localColumn : column
}

const localKeyColumns = (spec: SyncTableSpec): string[] =>
  spec.key.map((c) => localColumn(spec, c))

/**
 * Silences the dirty triggers for the duration of a write.
 *
 * Applying a pull would otherwise immediately mark every pulled row as owing a
 * push back, and clearing a flag after a push would set it straight back to 1.
 * The marker lives in a table rather than in memory because the triggers can
 * only see the database.
 */
export function muted<T>(fn: () => T, db: DatabaseType = getDb()): T {
  db.prepare("INSERT OR REPLACE INTO sync_state (key, value) VALUES ('sync_muted', '1')").run()
  try {
    return fn()
  } finally {
    db.prepare("DELETE FROM sync_state WHERE key = 'sync_muted'").run()
  }
}

/** The last server sequence this device has seen, or 0 before the first pull. */
export function getCursor(db: DatabaseType = getDb()): number {
  const row = db.prepare("SELECT value FROM sync_state WHERE key = 'cursor'").get() as
    | { value: string }
    | undefined
  return row ? Number(row.value) : 0
}

export function setCursor(seq: number, db: DatabaseType = getDb()): void {
  db.prepare("INSERT OR REPLACE INTO sync_state (key, value) VALUES ('cursor', ?)").run(String(seq))
}

/** Everything this device has changed since its last accepted push. */
export function pendingChanges(db: DatabaseType = getDb()): SyncRows {
  const rows: SyncRows = {}
  for (const spec of SYNC_TABLES) {
    const found = db.prepare(PENDING_SQL[spec.table]).all() as SyncRow[]
    if (found.length > 0) rows[spec.table] = found
  }
  return rows
}

/**
 * Clears the dirty flag on rows the server accepted.
 *
 * Guarded on `updated_at`: a row edited while the push was in flight no longer
 * matches, so it stays dirty and goes out with the next push instead of being
 * quietly dropped. Prayer time snapshots carry no `updated_at` because they are
 * never rewritten, so for those the key alone is enough.
 */
export function markPushed(rows: SyncRows, db: DatabaseType = getDb()): number {
  let cleared = 0
  muted(() => {
    for (const spec of SYNC_TABLES) {
      const outgoing = rows[spec.table]
      if (!outgoing?.length) continue

      const keyCols = localKeyColumns(spec)
      const guard = spec.columns.includes('updated_at') ? ' AND updated_at IS ?' : ''
      const sql = `UPDATE ${spec.table} SET dirty = 0
                   WHERE ${keyCols.map((c) => `${c} IS ?`).join(' AND ')}${guard}`
      const stmt = db.prepare(sql)

      for (const row of outgoing) {
        const local = toLocalRow(spec, row, db)
        if (!local) continue
        const params = keyCols.map((c) => local[c])
        if (guard) params.push(row.updated_at ?? null)
        cleared += stmt.run(...params).changes
      }
    }
  }, db)
  return cleared
}

/**
 * Turns a wire row into local column values, resolving the parent uid.
 *
 * Returns null when the parent is not on this device yet. That is not an error:
 * the parent may simply be later in a set that arrived out of order, and the
 * caller counts the row as deferred rather than losing it.
 */
function toLocalRow(
  spec: SyncTableSpec,
  row: SyncRow,
  db: DatabaseType
): Record<string, unknown> | null {
  const parent = PARENT[spec.table]
  const out: Record<string, unknown> = {}

  for (const column of spec.columns) {
    if (parent && column === parent.wireColumn) {
      const found = db
        .prepare(`SELECT id FROM ${parent.parentTable} WHERE uid = ?`)
        .get(row[column]) as { id: number } | undefined
      if (!found) return null
      out[parent.localColumn] = found.id
    } else {
      out[column] = row[column] ?? null
    }
  }
  return out
}

export interface ApplyResult {
  applied: number
  /** Rows an existing local edit beat, or that a first-write rule refused. */
  skipped: number
  /** Rows whose parent has not arrived yet; a later pull carries them again. */
  deferred: number
}

/**
 * Folds a change set into the local database.
 *
 * Applied in `SYNC_TABLES` order so a habit lands before its logs, and inside
 * one transaction so a set is either wholly present or wholly absent.
 */
export function applyChanges(set: ChangeSet, db: DatabaseType = getDb()): ApplyResult {
  const result: ApplyResult = { applied: 0, skipped: 0, deferred: 0 }

  const run = db.transaction(() => {
    muted(() => {
      for (const spec of SYNC_TABLES) {
        for (const row of set.rows[spec.table] ?? []) {
          const local = toLocalRow(spec, row, db)
          if (!local) {
            result.deferred++
            continue
          }
          if (!incomingWins(spec.policy, row, findLocal(spec, local, db))) {
            result.skipped++
            continue
          }
          upsert(spec, local, db)
          result.applied++
        }
      }
      if (result.applied > 0) reconcileGraceDays(db)
    }, db)

    if (set.seq !== undefined) setCursor(set.seq, db)
  })

  run()
  return result
}

/** The row already held under this key, as far as merging needs to know. */
function findLocal(
  spec: SyncTableSpec,
  local: Record<string, unknown>,
  db: DatabaseType
): SyncRow | undefined {
  const keyCols = localKeyColumns(spec)
  const where = keyCols.map((c) => `${c} IS ?`).join(' AND ')
  const column = spec.columns.includes('updated_at') ? 'updated_at' : '1 AS updated_at'
  return db
    .prepare(`SELECT ${column} FROM ${spec.table} WHERE ${where}`)
    .get(...keyCols.map((c) => local[c])) as SyncRow | undefined
}

function upsert(
  spec: SyncTableSpec,
  local: Record<string, unknown>,
  db: DatabaseType
): void {
  const columns = Object.keys(local)
  const keyCols = localKeyColumns(spec)
  const updatable = columns.filter((c) => !keyCols.includes(c))

  const sql = `INSERT INTO ${spec.table} (${columns.join(', ')}, dirty)
               VALUES (${columns.map((c) => `@${c}`).join(', ')}, 0)
               ON CONFLICT(${keyCols.join(', ')}) DO UPDATE SET
                 ${updatable.map((c) => `${c} = excluded.${c}`).join(', ')}, dirty = 0`
  db.prepare(sql).run(local)
}

/**
 * Restores the one-grace-day-per-month rule after a merge.
 *
 * Two devices offline can each spend the same month on a different day, and
 * because those are different rows nothing in a per-row merge notices. The
 * earliest one stands and the rest revert to an ordinary missed day, which is
 * the reading that keeps the streak honest rather than the one that flatters it.
 */
export function reconcileGraceDays(db: DatabaseType = getDb()): number {
  const extra = db
    .prepare(
      `SELECT habit_id, date FROM habit_logs
       WHERE grace = 1 AND deleted_at IS NULL
         AND date > (
           SELECT MIN(earlier.date) FROM habit_logs AS earlier
           WHERE earlier.habit_id = habit_logs.habit_id
             AND earlier.grace = 1 AND earlier.deleted_at IS NULL
             AND substr(earlier.date, 1, 7) = substr(habit_logs.date, 1, 7)
         )`
    )
    .all() as Array<{ habit_id: number; date: string }>

  // Marked dirty explicitly: this runs muted, inside a pull, but revoking a
  // grace day is a decision this device made and the server has not seen.
  const stmt = db.prepare(
    'UPDATE habit_logs SET grace = 0, updated_at = ?, dirty = 1 WHERE habit_id = ? AND date = ?'
  )
  const now = Date.now()
  for (const row of extra) stmt.run(now, row.habit_id, row.date)
  return extra.length
}

/** Convenience for callers that only need to know whether a push is worth making. */
export function hasPendingChanges(db: DatabaseType = getDb()): boolean {
  return SYNC_TABLES.some(
    (spec) =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${spec.table} WHERE dirty = 1`).get() as { n: number })
        .n > 0
  )
}

export { SYNC_TABLE_BY_NAME }
