/**
 * Sleep sessions — one night per logical day.
 *
 * No `uid` here, unlike habits and work sessions: `date` is already UNIQUE and
 * every accessor addresses a night by date, so the natural key is the identity
 * two devices will agree on.
 */
import type { DateStr, Millis, SleepSession } from '@shared/types'
import { getDb } from '../handle'

interface SleepRow {
  id: number
  date: DateStr
  sleep_at: Millis | null
  wake_at: Millis | null
  note: string | null
  updated_at: Millis
  deleted_at: Millis | null
}

const toSession = (r: SleepRow): SleepSession => ({
  id: r.id,
  date: r.date,
  sleepAt: r.sleep_at,
  wakeAt: r.wake_at,
  note: r.note
})

/** Deletes are tombstones, so every read has to exclude them explicitly. */
const LIVE = 'deleted_at IS NULL'

export function getSleepByDate(date: DateStr): SleepSession | null {
  const row = getDb().prepare(`SELECT * FROM sleep_sessions WHERE date = ? AND ${LIVE}`).get(date) as
    | SleepRow
    | undefined
  return row ? toSession(row) : null
}

export function listSleepInRange(from: DateStr, to: DateStr): SleepSession[] {
  return (
    getDb()
      .prepare(`SELECT * FROM sleep_sessions WHERE date BETWEEN ? AND ? AND ${LIVE} ORDER BY date`)
      .all(from, to) as SleepRow[]
  ).map(toSession)
}

/**
 * Guarantees a live row for the night.
 *
 * The upsert clears `deleted_at` rather than ignoring the conflict: a plain
 * INSERT OR IGNORE would leave a tombstoned night dead, and the write that
 * follows would silently vanish.
 */
function ensureRow(date: DateStr): void {
  getDb()
    .prepare(
      `INSERT INTO sleep_sessions (date, updated_at) VALUES (?, ?)
       ON CONFLICT(date) DO UPDATE SET deleted_at = NULL, updated_at = excluded.updated_at`
    )
    .run(date, Date.now())
}

/** Records "going to sleep" against the logical day the night belongs to. */
export function setSleepAt(date: DateStr, sleepAt: Millis | null): SleepSession {
  ensureRow(date)
  getDb()
    .prepare('UPDATE sleep_sessions SET sleep_at = ?, updated_at = ? WHERE date = ?')
    .run(sleepAt, Date.now(), date)
  return getSleepByDate(date)!
}

export function setWakeAt(date: DateStr, wakeAt: Millis | null): SleepSession {
  ensureRow(date)
  getDb()
    .prepare('UPDATE sleep_sessions SET wake_at = ?, updated_at = ? WHERE date = ?')
    .run(wakeAt, Date.now(), date)
  return getSleepByDate(date)!
}

export function updateSleep(
  date: DateStr,
  patch: { sleepAt?: Millis | null; wakeAt?: Millis | null; note?: string | null }
): SleepSession {
  ensureRow(date)
  const current = getSleepByDate(date)!
  getDb()
    .prepare(
      'UPDATE sleep_sessions SET sleep_at = ?, wake_at = ?, note = ?, updated_at = ? WHERE date = ?'
    )
    .run(
      patch.sleepAt === undefined ? current.sleepAt : patch.sleepAt,
      patch.wakeAt === undefined ? current.wakeAt : patch.wakeAt,
      patch.note === undefined ? current.note : patch.note?.trim() || null,
      Date.now(),
      date
    )
  return getSleepByDate(date)!
}

export function deleteSleep(date: DateStr): void {
  const now = Date.now()
  getDb()
    .prepare(`UPDATE sleep_sessions SET deleted_at = ?, updated_at = ? WHERE date = ? AND ${LIVE}`)
    .run(now, now, date)
}

/** The most recent night with a bedtime but no wake time — an open night. */
export function getOpenSleep(): SleepSession | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM sleep_sessions
       WHERE sleep_at IS NOT NULL AND wake_at IS NULL AND ${LIVE}
       ORDER BY sleep_at DESC LIMIT 1`
    )
    .get() as SleepRow | undefined
  return row ? toSession(row) : null
}

export function allSleepSessions(): SleepSession[] {
  return (
    getDb().prepare(`SELECT * FROM sleep_sessions WHERE ${LIVE} ORDER BY date`).all() as SleepRow[]
  ).map(toSession)
}

export function earliestSleepDate(): DateStr | null {
  const row = getDb().prepare(`SELECT MIN(date) AS d FROM sleep_sessions WHERE ${LIVE}`).get() as {
    d: DateStr | null
  }
  return row?.d ?? null
}
