/** Habits ("things I must do") and their daily logs. */
import type { DateStr, Habit, Millis } from '@shared/types'
import { ALL_DAYS_MASK } from '@shared/streaks'
import { uuidv7 } from '@shared/uid'
import { getDb } from '../handle'

interface HabitRow {
  id: number
  uid: string
  name: string
  position: number
  days_mask: number
  archived: number
  created_at: Millis
  updated_at: Millis
  deleted_at: Millis | null
}

const toHabit = (r: HabitRow): Habit => ({
  id: r.id,
  uid: r.uid,
  name: r.name,
  position: r.position,
  daysMask: r.days_mask,
  archived: r.archived === 1,
  createdAt: r.created_at
})

/**
 * Deletes are tombstones, so every read has to say so explicitly. A row with
 * `deleted_at` set is gone as far as anything above this layer is concerned.
 */
const LIVE = 'deleted_at IS NULL'

export function listHabits(includeArchived = false): Habit[] {
  const sql = includeArchived
    ? `SELECT * FROM habits WHERE ${LIVE} ORDER BY archived, position, id`
    : `SELECT * FROM habits WHERE ${LIVE} AND archived = 0 ORDER BY position, id`
  return (getDb().prepare(sql).all() as HabitRow[]).map(toHabit)
}

export function getHabit(id: number): Habit | null {
  const row = getDb().prepare(`SELECT * FROM habits WHERE id = ? AND ${LIVE}`).get(id) as
    | HabitRow
    | undefined
  return row ? toHabit(row) : null
}

/** The sync layer's lookup: incoming rows carry a uid, never a local id. */
export function getHabitByUid(uid: string): Habit | null {
  const row = getDb().prepare(`SELECT * FROM habits WHERE uid = ? AND ${LIVE}`).get(uid) as
    | HabitRow
    | undefined
  return row ? toHabit(row) : null
}

export function createHabit(name: string, daysMask = ALL_DAYS_MASK): Habit {
  const now = Date.now()
  const next = getDb()
    .prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM habits WHERE ${LIVE}`)
    .get() as { p: number }
  const info = getDb()
    .prepare(
      `INSERT INTO habits (uid, name, position, days_mask, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`
    )
    .run(uuidv7(now), name.trim(), next.p, daysMask & ALL_DAYS_MASK, now, now)
  return getHabit(Number(info.lastInsertRowid))!
}

export function updateHabit(
  id: number,
  patch: { name?: string; daysMask?: number; archived?: boolean }
): Habit | null {
  const current = getHabit(id)
  if (!current) return null
  getDb()
    .prepare('UPDATE habits SET name = ?, days_mask = ?, archived = ?, updated_at = ? WHERE id = ?')
    .run(
      patch.name?.trim() ?? current.name,
      (patch.daysMask ?? current.daysMask) & ALL_DAYS_MASK,
      (patch.archived ?? current.archived) ? 1 : 0,
      Date.now(),
      id
    )
  return getHabit(id)
}

/**
 * Removes a habit and its logs. Archiving is usually better.
 *
 * Both the habit and its logs are tombstoned rather than deleted: the foreign
 * key's ON DELETE CASCADE cannot fire for a row that still exists, and a real
 * delete would just be resurrected by the next pull from another device.
 */
export function deleteHabit(id: number): void {
  const now = Date.now()
  const db = getDb()
  db.transaction(() => {
    db.prepare(`UPDATE habit_logs SET deleted_at = ?, updated_at = ? WHERE habit_id = ? AND ${LIVE}`)
      .run(now, now, id)
    db.prepare(`UPDATE habits SET deleted_at = ?, updated_at = ? WHERE id = ? AND ${LIVE}`)
      .run(now, now, id)
  })()
}

export function reorderHabits(orderedIds: number[]): void {
  const now = Date.now()
  const stmt = getDb().prepare('UPDATE habits SET position = ?, updated_at = ? WHERE id = ?')
  getDb().transaction(() => {
    orderedIds.forEach((id, i) => stmt.run(i, now, id))
  })()
}

export interface HabitLogRow {
  habit_id: number
  date: DateStr
  done: number
  grace: number
  updated_at: Millis
  deleted_at: Millis | null
}

export function getHabitLogs(from: DateStr, to: DateStr): HabitLogRow[] {
  return getDb()
    .prepare(`SELECT * FROM habit_logs WHERE date BETWEEN ? AND ? AND ${LIVE} ORDER BY date`)
    .all(from, to) as HabitLogRow[]
}

export function getHabitLogsFor(habitId: number, from: DateStr, to: DateStr): HabitLogRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM habit_logs
       WHERE habit_id = ? AND date BETWEEN ? AND ? AND ${LIVE} ORDER BY date`
    )
    .all(habitId, from, to) as HabitLogRow[]
}

export function setHabitLog(habitId: number, date: DateStr, done: boolean, grace = false): void {
  const now = Date.now()
  if (!done && !grace) {
    getDb()
      .prepare(
        `UPDATE habit_logs SET deleted_at = ?, updated_at = ? WHERE habit_id = ? AND date = ?`
      )
      .run(now, now, habitId, date)
    return
  }
  // `deleted_at = NULL` on conflict is what makes re-ticking a cleared day work:
  // the tombstoned row is revived rather than left dead under a new write.
  getDb()
    .prepare(
      `INSERT INTO habit_logs (habit_id, date, done, grace, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(habit_id, date) DO UPDATE SET
         done = excluded.done, grace = excluded.grace,
         updated_at = excluded.updated_at, deleted_at = NULL`
    )
    .run(habitId, date, done ? 1 : 0, grace ? 1 : 0, now)
}

/** True when this habit has already spent its one grace day in `yearMonth` (YYYY-MM). */
export function graceUsedInMonth(habitId: number, yearMonth: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM habit_logs
       WHERE habit_id = ? AND grace = 1 AND date LIKE ? AND ${LIVE}`
    )
    .get(habitId, `${yearMonth}-%`) as { n: number }
  return row.n > 0
}

export function allHabitLogs(): HabitLogRow[] {
  return getDb()
    .prepare(`SELECT * FROM habit_logs WHERE ${LIVE} ORDER BY date, habit_id`)
    .all() as HabitLogRow[]
}

export function earliestHabitLogDate(): DateStr | null {
  const row = getDb().prepare(`SELECT MIN(date) AS d FROM habit_logs WHERE ${LIVE}`).get() as {
    d: DateStr | null
  }
  return row?.d ?? null
}
