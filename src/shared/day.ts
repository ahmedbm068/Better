/**
 * Day rollover.
 *
 * The logical day does not start at midnight — it starts at Fajr. Between
 * midnight and Fajr you are still in the previous logical day, which is what
 * makes "went to sleep at 01:00" belong to the day that just ended, and lets
 * the Isha window (which runs to the next morning's Fajr) sit inside one day.
 */
import type { DateStr, Millis } from './types'
import { addDays, dateStrInZone, MINUTE } from './time'

/** Resolves the Fajr instant for a calendar date. */
export type FajrResolver = (date: DateStr) => Millis

export interface RolloverOptions {
  tz: string
  /** Minutes added to Fajr to place the boundary. Usually 0. */
  offsetMin?: number
}

/**
 * The logical date an instant belongs to.
 *
 * `ms < Fajr(calendarDate) + offset` means the previous logical day is still
 * running.
 */
export function logicalDate(ms: Millis, fajrOf: FajrResolver, opts: RolloverOptions): DateStr {
  const calendar = dateStrInZone(ms, opts.tz)
  const boundary = fajrOf(calendar) + (opts.offsetMin ?? 0) * MINUTE
  return ms < boundary ? addDays(calendar, -1) : calendar
}

/** The instant a logical day begins (its own Fajr, plus offset). */
export function logicalDayStart(date: DateStr, fajrOf: FajrResolver, opts: RolloverOptions): Millis {
  return fajrOf(date) + (opts.offsetMin ?? 0) * MINUTE
}

/** The instant a logical day ends — exclusive; equals the next day's start. */
export function logicalDayEnd(date: DateStr, fajrOf: FajrResolver, opts: RolloverOptions): Millis {
  return logicalDayStart(addDays(date, 1), fajrOf, opts)
}

export function isWithinLogicalDay(
  ms: Millis,
  date: DateStr,
  fajrOf: FajrResolver,
  opts: RolloverOptions
): boolean {
  return ms >= logicalDayStart(date, fajrOf, opts) && ms < logicalDayEnd(date, fajrOf, opts)
}
