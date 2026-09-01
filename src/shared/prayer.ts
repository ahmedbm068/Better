/**
 * The prayer window state machine.
 *
 * Each prayer is valid only inside its own window, and — this is the point of
 * the app — a window that closes unchecked is missed, permanently. Nothing in
 * here can turn a missed prayer back into a done one.
 *
 * Windows:
 *   Fajr    [fajr, sunrise)      <- sunrise, NOT dhuhr
 *   Dhuhr   [dhuhr, asr)
 *   Asr     [asr, maghrib)
 *   Maghrib [maghrib, isha)
 *   Isha    [isha, next day's fajr)
 */
import type { DayPrayerTimes, Millis, PrayerName, PrayerStatus, PrayerWindow } from './types'
import { PRAYERS } from './types'

export function buildWindows(t: DayPrayerTimes): PrayerWindow[] {
  const raw: Array<[PrayerName, Millis, Millis]> = [
    ['fajr', t.fajr, t.sunrise],
    ['dhuhr', t.dhuhr, t.asr],
    ['asr', t.asr, t.maghrib],
    ['maghrib', t.maghrib, t.isha],
    ['isha', t.isha, t.nextFajr]
  ]
  // A window can never end before it starts, even if the source data is odd
  // (extreme latitudes, a bad manual coordinate).
  return raw.map(([prayer, start, end]) => ({ prayer, start, end: Math.max(start, end) }))
}

/**
 * Resolves one window against the clock.
 *
 * `doneAt` is only ever set by a check that happened inside the window — see
 * `isCheckable` — so a non-null value always means "done in time".
 */
export function statusFor(w: PrayerWindow, now: Millis, doneAt: Millis | null): PrayerStatus {
  const base = { prayer: w.prayer, start: w.start, end: w.end, msLeft: w.end - now }
  if (doneAt != null) return { ...base, state: 'done', doneAt }
  if (now >= w.end) return { ...base, state: 'missed', doneAt: null }
  if (now >= w.start) return { ...base, state: 'open', doneAt: null }
  return { ...base, state: 'upcoming', doneAt: null }
}

export function dayStatuses(
  t: DayPrayerTimes,
  now: Millis,
  marks: Partial<Record<PrayerName, Millis | null>>
): PrayerStatus[] {
  return buildWindows(t).map((w) => statusFor(w, now, marks[w.prayer] ?? null))
}

/** A prayer may be checked off only while its own window is open. */
export function isCheckable(w: PrayerWindow, now: Millis): boolean {
  return now >= w.start && now < w.end
}

export function windowFor(t: DayPrayerTimes, prayer: PrayerName): PrayerWindow {
  const w = buildWindows(t).find((x) => x.prayer === prayer)
  if (!w) throw new Error(`unknown prayer: ${prayer}`)
  return w
}

/** The window currently open, if any. Windows do not overlap, so at most one. */
export function currentWindow(statuses: PrayerStatus[], now: Millis): PrayerStatus | null {
  return statuses.find((s) => now >= s.start && now < s.end) ?? null
}

/** The next window to open after `now`, within this day's set. */
export function nextWindow(statuses: PrayerStatus[], now: Millis): PrayerStatus | null {
  return statuses.filter((s) => s.start > now).sort((a, b) => a.start - b.start)[0] ?? null
}

export function countDone(statuses: PrayerStatus[]): number {
  return statuses.filter((s) => s.state === 'done').length
}

/** True when all five were checked inside their windows. Drives the 5/5 streak. */
export function isPerfectDay(statuses: PrayerStatus[]): boolean {
  return statuses.length === PRAYERS.length && statuses.every((s) => s.state === 'done')
}

/** True once every window of the day has closed — the day can no longer change. */
export function isDaySettled(statuses: PrayerStatus[], now: Millis): boolean {
  return statuses.every((s) => now >= s.end)
}
