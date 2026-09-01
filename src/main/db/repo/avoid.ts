/** The avoid list ("things I must not do") and its per-day resolution. */
import type { AvoidItem, AvoidLog, AvoidStatus, DateStr, Millis } from '@shared/types'
import { uuidv7 } from '@shared/uid'
import { getDb } from '../handle'

interface AvoidRow {
  id: number
  uid: string
  name: string
  position: number
  archived: number
  is_quit_tracker: number
  created_at: Millis
  updated_at: Millis
  deleted_at: Millis | null
}

const toItem = (r: AvoidRow): AvoidItem => ({
  id: r.id,
  uid: r.uid,
  name: r.name,
  position: r.position,
  archived: r.archived === 1,
  isQuitTracker: r.is_quit_tracker === 1,
  createdAt: r.created_at
})

/** Deletes are tombstones, so every read has to exclude them explicitly. */
const LIVE = 'deleted_at IS NULL'

export function listAvoidItems(includeArchived = false): AvoidItem[] {
  const sql = includeArchived
    ? `SELECT * FROM avoid_items WHERE ${LIVE} ORDER BY archived, position, id`
    : `SELECT * FROM avoid_items WHERE ${LIVE} AND archived = 0 ORDER BY position, id`
  return (getDb().prepare(sql).all() as AvoidRow[]).map(toItem)
}

export function getAvoidItem(id: number): AvoidItem | null {
  const row = getDb().prepare(`SELECT * FROM avoid_items WHERE id = ? AND ${LIVE}`).get(id) as
    | AvoidRow
    | undefined
  return row ? toItem(row) : null
}

/** The sync layer's lookup: incoming rows carry a uid, never a local id. */
export function getAvoidItemByUid(uid: string): AvoidItem | null {
  const row = getDb().prepare(`SELECT * FROM avoid_items WHERE uid = ? AND ${LIVE}`).get(uid) as
    | AvoidRow
    | undefined
  return row ? toItem(row) : null
}

/** The item the pinned quit-counter card follows, if one is flagged. */
export function getQuitTrackerItem(): AvoidItem | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM avoid_items WHERE is_quit_tracker = 1 AND archived = 0 AND ${LIVE} LIMIT 1`
    )
    .get() as AvoidRow | undefined
  return row ? toItem(row) : null
}

export function createAvoidItem(name: string, isQuitTracker = false): AvoidItem {
  const now = Date.now()
  const next = getDb()
    .prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM avoid_items WHERE ${LIVE}`)
    .get() as { p: number }
  const info = getDb()
    .prepare(
      `INSERT INTO avoid_items (uid, name, position, archived, is_quit_tracker, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?, ?)`
    )
    .run(uuidv7(now), name.trim(), next.p, isQuitTracker ? 1 : 0, now, now)
  return getAvoidItem(Number(info.lastInsertRowid))!
}

export function updateAvoidItem(
  id: number,
  patch: { name?: string; archived?: boolean; isQuitTracker?: boolean }
): AvoidItem | null {
  const current = getAvoidItem(id)
  if (!current) return null
  const now = Date.now()
  const run = getDb().transaction(() => {
    // Only one item can own the pinned quit card.
    if (patch.isQuitTracker) {
      getDb()
        .prepare(`UPDATE avoid_items SET is_quit_tracker = 0, updated_at = ? WHERE ${LIVE}`)
        .run(now)
    }
    getDb()
      .prepare(
        'UPDATE avoid_items SET name = ?, archived = ?, is_quit_tracker = ?, updated_at = ? WHERE id = ?'
      )
      .run(
        patch.name?.trim() ?? current.name,
        (patch.archived ?? current.archived) ? 1 : 0,
        (patch.isQuitTracker ?? current.isQuitTracker) ? 1 : 0,
        now,
        id
      )
  })
  run()
  return getAvoidItem(id)
}

/** Tombstones the item and its logs — see `deleteHabit` for why both. */
export function deleteAvoidItem(id: number): void {
  const now = Date.now()
  const db = getDb()
  db.transaction(() => {
    db.prepare(`UPDATE avoid_logs SET deleted_at = ?, updated_at = ? WHERE item_id = ? AND ${LIVE}`)
      .run(now, now, id)
    db.prepare(`UPDATE avoid_items SET deleted_at = ?, updated_at = ? WHERE id = ? AND ${LIVE}`)
      .run(now, now, id)
  })()
}

export function reorderAvoidItems(orderedIds: number[]): void {
  const now = Date.now()
  const stmt = getDb().prepare('UPDATE avoid_items SET position = ?, updated_at = ? WHERE id = ?')
  getDb().transaction(() => {
    orderedIds.forEach((id, i) => stmt.run(i, now, id))
  })()
}

interface AvoidLogRow {
  item_id: number
  date: DateStr
  status: AvoidStatus
  note: string | null
  updated_at: Millis
  deleted_at: Millis | null
}

const toLog = (r: AvoidLogRow): AvoidLog => ({
  itemId: r.item_id,
  date: r.date,
  status: r.status,
  note: r.note,
  updatedAt: r.updated_at
})

export function getAvoidLogs(from: DateStr, to: DateStr): AvoidLog[] {
  return (
    getDb()
      .prepare(`SELECT * FROM avoid_logs WHERE date BETWEEN ? AND ? AND ${LIVE} ORDER BY date`)
      .all(from, to) as AvoidLogRow[]
  ).map(toLog)
}

export function getAvoidLogsFor(itemId: number, from: DateStr, to: DateStr): AvoidLog[] {
  return (
    getDb()
      .prepare(
        `SELECT * FROM avoid_logs
         WHERE item_id = ? AND date BETWEEN ? AND ? AND ${LIVE} ORDER BY date`
      )
      .all(itemId, from, to) as AvoidLogRow[]
  ).map(toLog)
}

/** Marks the day clean, or logs a slip with an optional one-line note. */
export function setAvoidLog(
  itemId: number,
  date: DateStr,
  status: AvoidStatus | null,
  note?: string | null
): void {
  const now = Date.now()
  if (status === null) {
    getDb()
      .prepare('UPDATE avoid_logs SET deleted_at = ?, updated_at = ? WHERE item_id = ? AND date = ?')
      .run(now, now, itemId, date)
    return
  }
  // Reviving the tombstone is what lets a cleared day be logged again.
  getDb()
    .prepare(
      `INSERT INTO avoid_logs (item_id, date, status, note, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(item_id, date) DO UPDATE SET
         status = excluded.status, note = excluded.note,
         updated_at = excluded.updated_at, deleted_at = NULL`
    )
    .run(itemId, date, status, note?.trim() || null, now)
}

export function allAvoidLogs(): AvoidLog[] {
  return (
    getDb()
      .prepare(`SELECT * FROM avoid_logs WHERE ${LIVE} ORDER BY date, item_id`)
      .all() as AvoidLogRow[]
  ).map(toLog)
}

export function earliestAvoidLogDate(): DateStr | null {
  const row = getDb().prepare(`SELECT MIN(date) AS d FROM avoid_logs WHERE ${LIVE}`).get() as {
    d: DateStr | null
  }
  return row?.d ?? null
}

/** Days with at least one slip, for the calendar dot. */
export function datesWithSlips(from: DateStr, to: DateStr): Set<DateStr> {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT date FROM avoid_logs
       WHERE status = 'slip' AND date BETWEEN ? AND ? AND ${LIVE}`
    )
    .all(from, to) as Array<{ date: DateStr }>
  return new Set(rows.map((r) => r.date))
}
