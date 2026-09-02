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
import type {
  DayPrayerTimes,
  Millis,
  PrayerName,
  PrayerStatus,
  PrayerWindow,
  StreakInfo
} from './types'
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
 * True when all five were checked inside their windows — the clean case.
 *
 * A made-up prayer does not qualify. See `prayerStreakDay` below for the
 * broader question the streak actually asks, which is not quite this one.
 */
export function isPerfectDay(statuses: PrayerStatus[]): boolean {
  return statuses.length === PRAYERS.length && statuses.every((s) => s.state === 'done')
}

/** True once every window of the day has closed — the day can no longer change. */
export function isDaySettled(statuses: PrayerStatus[], now: Millis): boolean {
  return statuses.every((s) => now >= s.end)
}

/**
 * How one day counts toward the prayer streak — a wider question than
 * `isPerfectDay`, because a late prayer, caught up in time, should not cost
 * you the streak. It should just stop being invisible about it.
 *
 *   perfect  every prayer inside its own window. The clean case.
 *   kept     every prayer was prayed, but one or more were made up — and
 *            every make-up landed before `nextFajr`. The streak survives,
 *            marked differently, because the day was not clean.
 *   broken   a prayer missed outright, or made up on or after `nextFajr` —
 *            too late to save the day, whatever the general make-up
 *            allowance (`MAKEUP_WINDOW_MS`, two days) still lets you record
 *            it as for the day's own score and history.
 *   pending  undecided: the day is not over and there is still time
 *            (`now < nextFajr`) to catch up. Never breaks a run in progress.
 *
 * `nextFajr` is the same instant that already closes the Isha window (see
 * `buildWindows`) — the streak's cutoff and the calendar day's own boundary
 * are the same moment on purpose. A doneAt is always <= now, so a day cannot
 * be found `broken` by a late catch-up before its own cutoff has passed —
 * only `pending` can precede that, which is what keeps a run in progress from
 * being judged before it is over.
 */
export type PrayerDayOutcome = 'perfect' | 'kept' | 'broken' | 'pending'

export function prayerStreakDay(
  statuses: PrayerStatus[],
  nextFajr: Millis,
  now: Millis
): PrayerDayOutcome {
  let anyLate = false
  let anyUnresolved = false
  for (const s of statuses) {
    if (s.state === 'done') continue
    if (s.state === 'late') {
      if (s.doneAt != null && s.doneAt < nextFajr) {
        anyLate = true
        continue
      }
      return 'broken'
    }
    // missed, open, or upcoming: not prayed yet, one way or the other.
    anyUnresolved = true
  }
  if (anyUnresolved) return now < nextFajr ? 'pending' : 'broken'
  return anyLate ? 'kept' : 'perfect'
}

/**
 * Turns a day-by-day outcome list (oldest first) into a streak.
 *
 * `perfect` and `kept` both extend a run — a late prayer, caught up before its
 * deadline, is a kept promise, not a broken one. Only `broken` ends it, and
 * `pending` (today, still in progress) neither extends nor breaks it, the same
 * as an in-progress habit day.
 *
 * `pure` says whether the *current* run is unbroken by a single catch-up —
 * true only once every day in it was `perfect`. It flips to false, and stays
 * there for the run, the moment one day in it was merely `kept`.
 */
export function prayerStreakFromOutcomes(outcomes: PrayerDayOutcome[]): StreakInfo {
  let current = 0
  let pure = true
  for (let i = outcomes.length - 1; i >= 0; i--) {
    const o = outcomes[i]
    if (o === 'pending') continue
    if (o === 'broken') break
    current++
    if (o === 'kept') pure = false
  }

  let best = 0
  let run = 0
  for (const o of outcomes) {
    if (o === 'pending') continue
    if (o === 'broken') {
      run = 0
      continue
    }
    run++
    best = Math.max(best, run)
  }

  return { current, record: Math.max(best, current), pure: current > 0 && pure }
}
