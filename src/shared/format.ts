/** Formatting shared by the main process (tray, notifications) and the UI. */
import type { DateStr, Millis } from './types'
import { zonedParts } from './time'

const pad = (n: number) => String(n).padStart(2, '0')

/** "1h 42m", "42m", "58s" — compact, for countdowns and tray tooltips. */
export function formatDurationShort(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0m'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${pad(m)}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}

/** "1:42:07" — for a live timer where seconds matter. */
export function formatStopwatch(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** "7h 30m" from a duration in seconds or minutes. */
export function formatHoursMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`
}

export function formatSecondsAsHours(seconds: number): string {
  return formatHoursMinutes(seconds / 60)
}

/** Wall-clock "HH:MM" of an instant, in a zone. */
export function formatClock(ms: Millis | null | undefined, tz: string): string {
  if (ms == null) return '--:--'
  const p = zonedParts(ms, tz)
  return `${pad(p.hour)}:${pad(p.minute)}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
export const WEEKDAY_NAMES = WEEKDAYS

/** "Mon 30 Aug" */
export function formatDateShort(date: DateStr): string {
  const [y, m, d] = date.split('-').map(Number)
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${WEEKDAYS[wd]} ${d} ${MONTHS[m - 1]}`
}

/** "30 August 2026" */
export function formatDateLong(date: DateStr): string {
  const [y, m, d] = date.split('-').map(Number)
  const full = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]
  return `${d} ${full[m - 1]} ${y}`
}

export function formatMonthYear(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`
}

/** Minutes past midnight rendered as a clock, for chart axes. */
export function minutesToClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

/** Reverses the 18:00-anchored bedtime axis back to a readable clock. */
export function plotMinutesToClock(plot: number): string {
  return minutesToClock(plot + 18 * 60)
}

export function formatMoney(amount: number, currency: string): string {
  const rounded = Math.round(amount * 100) / 100
  return `${rounded.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
}

export function pluralDays(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`
}
