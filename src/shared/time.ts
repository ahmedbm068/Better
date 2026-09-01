/**
 * Timezone-aware date/time helpers.
 *
 * Everything the app stores is epoch-millis. Everything the app *shows* or
 * groups by day is resolved in the configured IANA zone (default: the system
 * zone), so the app stays correct if the machine's clock zone differs from the
 * zone the prayer times were computed for.
 */
import type { DateStr, Millis } from './types'

export const MINUTE = 60_000
export const HOUR = 3_600_000
export const DAY = 86_400_000

export function systemZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
    formatterCache.set(tz, f)
  }
  return f
}

export interface ZonedParts {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  second: number
}

export function zonedParts(ms: Millis, tz: string): ZonedParts {
  const parts = partsFormatter(tz).formatToParts(new Date(ms))
  const map: Record<string, string> = {}
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second)
  }
}

/** Offset of `tz` from UTC at instant `ms`, in milliseconds (east positive). */
export function zoneOffsetMs(ms: Millis, tz: string): number {
  const p = zonedParts(ms, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(ms / 1000) * 1000
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** The `YYYY-MM-DD` calendar date of an instant, as seen in `tz`. */
export function dateStrInZone(ms: Millis, tz: string): DateStr {
  const p = zonedParts(ms, tz)
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`
}

/**
 * Converts a wall-clock time in `tz` to epoch millis. Converges in two passes,
 * which is enough for every real zone including DST transitions.
 */
export function zonedTimeToMs(date: DateStr, hour: number, minute: number, tz: string, second = 0): Millis {
  const [y, m, d] = date.split('-').map(Number)
  const naive = Date.UTC(y, m - 1, d, hour, minute, second)
  let guess = naive - zoneOffsetMs(naive, tz)
  guess = naive - zoneOffsetMs(guess, tz)
  return guess
}

/** Midnight (00:00) of a calendar date in `tz`. */
export function startOfDayMs(date: DateStr, tz: string): Millis {
  return zonedTimeToMs(date, 0, 0, tz)
}

export function parseHHMM(hhmm: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return { hour: 0, minute: 0 }
  return { hour: Math.min(23, Number(m[1])), minute: Math.min(59, Number(m[2])) }
}

export function addDays(date: DateStr, n: number): DateStr {
  const [y, m, d] = date.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d) + n * DAY
  const dt = new Date(t)
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

/** Whole days from `a` to `b` (b - a). */
export function daysBetween(a: DateStr, b: DateStr): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY)
}

/** 0 = Sunday .. 6 = Saturday. Calendar-only, no zone needed. */
export function weekdayOf(date: DateStr): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Monday-based week start, so the Sunday review closes the week. */
export function startOfWeek(date: DateStr): DateStr {
  const wd = weekdayOf(date)
  return addDays(date, wd === 0 ? -6 : 1 - wd)
}

export function endOfWeek(date: DateStr): DateStr {
  return addDays(startOfWeek(date), 6)
}

export function rangeDates(from: DateStr, to: DateStr): DateStr[] {
  const out: DateStr[] = []
  for (let d = from; daysBetween(d, to) >= 0; d = addDays(d, 1)) out.push(d)
  return out
}

export function monthGridRange(year: number, month: number): { from: DateStr; to: DateStr } {
  const first: DateStr = `${pad(year, 4)}-${pad(month)}-01`
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const last: DateStr = `${pad(year, 4)}-${pad(month)}-${pad(daysInMonth)}`
  return { from: startOfWeek(first), to: endOfWeek(last) }
}

/** Minutes since midnight for an instant, in `tz`. */
export function wallMinutes(ms: Millis, tz: string): number {
  const p = zonedParts(ms, tz)
  return p.hour * 60 + p.minute
}

/** Smallest circular distance in minutes between two clock times (0..720). */
export function clockDistanceMin(aMin: number, bMin: number): number {
  const raw = Math.abs(((aMin - bMin) % 1440) + 1440) % 1440
  return Math.min(raw, 1440 - raw)
}

/** ISO-8601 week number. Week 1 is the one containing the first Thursday. */
export function isoWeekNumber(date: DateStr): number {
  const [y, m, d] = date.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d)
  const dt = new Date(t)
  // Shift to the Thursday of this week, then count weeks from 1 January.
  const day = (dt.getUTCDay() + 6) % 7
  dt.setUTCDate(dt.getUTCDate() - day + 3)
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4))
  const firstDay = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3)
  return 1 + Math.round((dt.getTime() - firstThursday.getTime()) / (7 * DAY))
}

/** "TUNIS · UTC+1" — the place and offset, derived rather than hardcoded. */
export function zoneLabel(tz: string, at: Millis = Date.now()): string {
  const city = (tz.split('/').pop() ?? tz).replace(/_/g, ' ').toUpperCase()
  const minutes = Math.round(zoneOffsetMs(at, tz) / MINUTE)
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `${city} · UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`
}
