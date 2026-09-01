/** Prayer time snapshots and the marks that record a prayer done in time. */
import type { DateStr, Millis, PrayerName } from '@shared/types'
import { getDb } from '../handle'

/**
 * Un-checking is a tombstone, so every read of a mark excludes them explicitly.
 *
 * `prayer_times` below carries no tombstone and no `updated_at` on purpose: a
 * snapshot is written once and is never the loser of a merge. Two devices that
 * computed a day differently must not overwrite each other, or history would be
 * rewritten — the rule the app exists to hold. First write wins; the sync layer
 * enforces it.
 */
const LIVE = 'deleted_at IS NULL'

export interface PrayerTimesRow {
  date: DateStr
  fajr: Millis
  sunrise: Millis
  dhuhr: Millis
  asr: Millis
  maghrib: Millis
  isha: Millis
  latitude: number
  longitude: number
  method: string
  madhab: string
  tz: string
  computed_at: Millis
}

export function getTimesRow(date: DateStr): PrayerTimesRow | null {
  return (
    (getDb().prepare('SELECT * FROM prayer_times WHERE date = ?').get(date) as
      | PrayerTimesRow
      | undefined) ?? null
  )
}

export function putTimesRow(row: PrayerTimesRow): void {
  getDb()
    .prepare(
      `INSERT INTO prayer_times
        (date, fajr, sunrise, dhuhr, asr, maghrib, isha, latitude, longitude, method, madhab, tz, computed_at)
       VALUES (@date, @fajr, @sunrise, @dhuhr, @asr, @maghrib, @isha, @latitude, @longitude, @method, @madhab, @tz, @computed_at)
       ON CONFLICT(date) DO UPDATE SET
         fajr=excluded.fajr, sunrise=excluded.sunrise, dhuhr=excluded.dhuhr, asr=excluded.asr,
         maghrib=excluded.maghrib, isha=excluded.isha, latitude=excluded.latitude,
         longitude=excluded.longitude, method=excluded.method, madhab=excluded.madhab,
         tz=excluded.tz, computed_at=excluded.computed_at`
    )
    .run(row as unknown as Record<string, unknown>)
}

/**
 * Drops cached times from `date` onward. Called when the location or method
 * changes, so future days pick up new settings while history stays intact.
 */
export function invalidateTimesFrom(date: DateStr): number {
  return getDb().prepare('DELETE FROM prayer_times WHERE date >= ?').run(date).changes
}

export function getMarks(date: DateStr): Partial<Record<PrayerName, Millis>> {
  const rows = getDb()
    .prepare(`SELECT prayer, done_at FROM prayer_marks WHERE date = ? AND ${LIVE}`)
    .all(date) as Array<{ prayer: PrayerName; done_at: Millis }>
  const out: Partial<Record<PrayerName, Millis>> = {}
  for (const r of rows) out[r.prayer] = r.done_at
  return out
}

export function getMarksInRange(
  from: DateStr,
  to: DateStr
): Map<DateStr, Partial<Record<PrayerName, Millis>>> {
  const rows = getDb()
    .prepare(
      `SELECT date, prayer, done_at FROM prayer_marks WHERE date BETWEEN ? AND ? AND ${LIVE}`
    )
    .all(from, to) as Array<{ date: DateStr; prayer: PrayerName; done_at: Millis }>
  const map = new Map<DateStr, Partial<Record<PrayerName, Millis>>>()
  for (const r of rows) {
    const entry = map.get(r.date) ?? {}
    entry[r.prayer] = r.done_at
    map.set(r.date, entry)
  }
  return map
}

/** Records a prayer as done. The window check lives in the service layer. */
export function setMark(date: DateStr, prayer: PrayerName, doneAt: Millis): void {
  getDb()
    .prepare(
      `INSERT INTO prayer_marks (date, prayer, done_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(date, prayer) DO UPDATE SET
         done_at = excluded.done_at, updated_at = excluded.updated_at, deleted_at = NULL`
    )
    .run(date, prayer, doneAt, Date.now())
}

/** Un-checks a prayer. Only legal while its window is still open. */
export function clearMark(date: DateStr, prayer: PrayerName): void {
  const now = Date.now()
  getDb()
    .prepare('UPDATE prayer_marks SET deleted_at = ?, updated_at = ? WHERE date = ? AND prayer = ?')
    .run(now, now, date, prayer)
}

/** The earliest day with a recorded prayer — where prayer history starts. */
export function earliestMarkDate(): DateStr | null {
  const row = getDb().prepare(`SELECT MIN(date) AS d FROM prayer_marks WHERE ${LIVE}`).get() as {
    d: DateStr | null
  }
  return row?.d ?? null
}

export function allMarks(): Array<{ date: DateStr; prayer: PrayerName; done_at: Millis }> {
  return getDb()
    .prepare(`SELECT date, prayer, done_at FROM prayer_marks WHERE ${LIVE} ORDER BY date, prayer`)
    .all() as Array<{ date: DateStr; prayer: PrayerName; done_at: Millis }>
}

export function allTimesRows(): PrayerTimesRow[] {
  return getDb().prepare('SELECT * FROM prayer_times ORDER BY date').all() as PrayerTimesRow[]
}
