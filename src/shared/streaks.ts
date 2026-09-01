/**
 * Streak rules.
 *
 * Deliberately not all-or-nothing:
 *  - the all-time record is kept and shown next to the current streak, so a
 *    broken streak never erases the evidence that you did it before;
 *  - a day the item does not apply to (gym on a Tuesday) is skipped, not broken;
 *  - a grace day keeps the run alive without counting as a completed day, so
 *    the number stays honest;
 *  - today is never counted against you while it is still running.
 */
import type { DateStr, StreakInfo } from './types'

export interface StreakDay {
  date: DateStr
  /** Does this item apply on this day at all? */
  applies: boolean
  done: boolean
  /** Grace keeps the run alive but adds nothing to the count. */
  grace: boolean
  /** The day is still in progress — it can neither extend nor break a run. */
  pending?: boolean
}

/** Current run, counted backwards from the most recent day. */
export function currentStreak(days: StreakDay[]): number {
  let count = 0
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]
    if (!d.applies) continue
    if (d.done) {
      count++
      continue
    }
    if (d.grace) continue
    if (d.pending) continue
    break
  }
  return count
}

/** Longest run anywhere in the history, under the same rules. */
export function recordStreak(days: StreakDay[]): number {
  let best = 0
  let run = 0
  for (const d of days) {
    if (!d.applies) continue
    if (d.done) {
      run++
      best = Math.max(best, run)
      continue
    }
    if (d.grace || d.pending) continue
    run = 0
  }
  return best
}

export function computeStreakInfo(days: StreakDay[], graceAvailable?: boolean): StreakInfo {
  const info: StreakInfo = { current: currentStreak(days), record: recordStreak(days) }
  // The record must never be smaller than the run currently in progress.
  info.record = Math.max(info.record, info.current)
  if (graceAvailable !== undefined) info.graceAvailable = graceAvailable
  return info
}

/** Weekday bitmask helpers — bit 0 = Sunday .. bit 6 = Saturday. */
export const ALL_DAYS_MASK = 0b1111111

export function appliesOnWeekday(daysMask: number, weekday: number): boolean {
  return (daysMask & (1 << weekday)) !== 0
}

export function maskFromWeekdays(weekdays: number[]): number {
  return weekdays.reduce((m, d) => m | (1 << d), 0)
}

export function weekdaysFromMask(mask: number): number[] {
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => appliesOnWeekday(mask, d))
}
