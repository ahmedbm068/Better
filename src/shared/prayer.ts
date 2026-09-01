/**
 * The prayer window state machine.
 *
 * Each prayer is on time only inside its own window, and — this is the point of
 * the app — a window that closes unchecked is missed. Nothing in here can turn
 * a missed prayer back into a done one.
 *
 * What it can become is `late`: a prayer owed and then made up. That is a real
 * thing to record, so the app records it, in its own state, worth its own
 * fewer points, and only for a short while afterwards. A missed prayer you make
 * up is better than one you abandon; it is not the same as one you kept.
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
 * How long after a window closes a prayer may still be recorded as made up.
 *
 * Two days covers the cases that actually happen — a missed Isha prayed the
 * next morning, a missed Fajr prayed that afternoon — and stops well short of
 * letting last month be quietly rewritten. History has to stop being editable
 * somewhere, or the record it keeps is worth nothing.
 */
export const MAKEUP_WINDOW_MS = 48 * 60 * 60 * 1000

/**
 * Resolves one window against the clock.
 *
 * Lateness is derived from *when* the check happened, never stored: a mark is
 * late exactly when it was written after its window had closed. The window is
 * fixed once the day's times are recorded, so this answer cannot drift — and
 * every mark made before make-ups existed reads as `done`, which is what it was.
 */
export function statusFor(w: PrayerWindow, now: Millis, doneAt: Millis | null): PrayerStatus {
  const base = {
    prayer: w.prayer,
    start: w.start,
    end: w.end,
    msLeft: w.end - now,
    canMakeUp: isMakeUpAble(w, now)
  }
  if (doneAt != null) {
    return doneAt < w.end
      ? { ...base, state: 'done', doneAt, canMakeUp: false }
      : { ...base, state: 'late', doneAt }
  }
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

/** A prayer counts as done *in time* only while its own window is open. */
export function isCheckable(w: PrayerWindow, now: Millis): boolean {
  return now >= w.start && now < w.end
}

/** The window has closed, but the prayer can still be recorded as made up. */
export function isMakeUpAble(w: PrayerWindow, now: Millis): boolean {
  return now >= w.end && now < w.end + MAKEUP_WINDOW_MS
}

/** Every moment a mark may be written at all — on time, or as a make-up. */
export function isRecordable(w: PrayerWindow, now: Millis): boolean {
  return isCheckable(w, now) || isMakeUpAble(w, now)
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

/** Prayed inside the window. Make-ups are counted separately, never here. */
export function countDone(statuses: PrayerStatus[]): number {
  return statuses.filter((s) => s.state === 'done').length
}

/** Prayed after the window closed. */
export function countLate(statuses: PrayerStatus[]): number {
  return statuses.filter((s) => s.state === 'late').length
}

/** Prayed at all, on time or made up — what the day's "x/5" shows. */
export function countPrayed(statuses: PrayerStatus[]): number {
  return countDone(statuses) + countLate(statuses)
}

/**
 * True when all five were checked inside their windows. Drives the 5/5 streak.
 *
 * A made-up prayer does not qualify, and that is deliberate: the streak is for
 * days you kept, and a day rescued afterwards is not one of them.
 */
export function isPerfectDay(statuses: PrayerStatus[]): boolean {
  return statuses.length === PRAYERS.length && statuses.every((s) => s.state === 'done')
}

/** True once every window of the day has closed — the day can no longer change. */
export function isDaySettled(statuses: PrayerStatus[], now: Millis): boolean {
  return statuses.every((s) => now >= s.end)
}
