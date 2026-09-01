/** Day notes, weekly reviews, and the notification dedupe log. */
import type { DateStr, Millis, WeeklyReview } from '@shared/types'
import { getDb } from '../handle'

/**
 * Deletes are tombstones, so every read has to exclude them explicitly.
 *
 * `notification_log` below is deliberately exempt: it is this machine's record
 * of what it has already shown, not the user's data, and never syncs.
 */
const LIVE = 'deleted_at IS NULL'

export function getDayNote(date: DateStr): string | null {
  const row = getDb().prepare(`SELECT note FROM day_notes WHERE date = ? AND ${LIVE}`).get(date) as
    | { note: string }
    | undefined
  return row?.note ?? null
}

/** Notes stay editable on past days — they are the one thing history allows. */
export function setDayNote(date: DateStr, note: string): void {
  const trimmed = note.trim()
  const now = Date.now()
  if (!trimmed) {
    getDb()
      .prepare('UPDATE day_notes SET deleted_at = ?, updated_at = ? WHERE date = ?')
      .run(now, now, date)
    return
  }
  getDb()
    .prepare(
      `INSERT INTO day_notes (date, note, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         note = excluded.note, updated_at = excluded.updated_at, deleted_at = NULL`
    )
    .run(date, trimmed, now)
}

export function getDayNotes(from: DateStr, to: DateStr): Map<DateStr, string> {
  const rows = getDb()
    .prepare(`SELECT date, note FROM day_notes WHERE date BETWEEN ? AND ? AND ${LIVE}`)
    .all(from, to) as Array<{ date: DateStr; note: string }>
  return new Map(rows.map((r) => [r.date, r.note]))
}

interface ReviewRow {
  week_start: DateStr
  note: string
  fix_next: string
  created_at: Millis
  updated_at: Millis
  deleted_at: Millis | null
}

const toReview = (r: ReviewRow): WeeklyReview => ({
  weekStart: r.week_start,
  note: r.note,
  fixNext: r.fix_next,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export function getReview(weekStart: DateStr): WeeklyReview | null {
  const row = getDb()
    .prepare(`SELECT * FROM weekly_reviews WHERE week_start = ? AND ${LIVE}`)
    .get(weekStart) as ReviewRow | undefined
  return row ? toReview(row) : null
}

export function saveReview(weekStart: DateStr, note: string, fixNext: string): WeeklyReview {
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO weekly_reviews (week_start, note, fix_next, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(week_start) DO UPDATE SET
         note = excluded.note, fix_next = excluded.fix_next,
         updated_at = excluded.updated_at, deleted_at = NULL`
    )
    .run(weekStart, note.trim(), fixNext.trim(), now, now)
  return getReview(weekStart)!
}

export function listReviews(): WeeklyReview[] {
  return (
    getDb()
      .prepare(`SELECT * FROM weekly_reviews WHERE ${LIVE} ORDER BY week_start DESC`)
      .all() as ReviewRow[]
  ).map(toReview)
}

export function deleteReview(weekStart: DateStr): void {
  const now = Date.now()
  getDb()
    .prepare('UPDATE weekly_reviews SET deleted_at = ?, updated_at = ? WHERE week_start = ?')
    .run(now, now, weekStart)
}

/**
 * Notification dedupe. Keys look like `2026-08-30:asr:lead-30`, so a reminder
 * survives a restart without firing twice.
 */
export function wasNotificationSent(key: string): boolean {
  const row = getDb().prepare('SELECT 1 AS x FROM notification_log WHERE key = ?').get(key)
  return row !== undefined
}

export function markNotificationSent(key: string): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO notification_log (key, sent_at) VALUES (?, ?)')
    .run(key, Date.now())
}

/** Keeps the dedupe table from growing without bound. */
export function pruneNotificationLog(olderThanMs: number): number {
  return getDb().prepare('DELETE FROM notification_log WHERE sent_at < ?').run(olderThanMs).changes
}

export function allDayNotes(): Array<{ date: DateStr; note: string }> {
  return getDb()
    .prepare(`SELECT date, note FROM day_notes WHERE ${LIVE} ORDER BY date`)
    .all() as Array<{
    date: DateStr
    note: string
  }>
}
