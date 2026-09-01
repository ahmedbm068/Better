/**
 * Sleep tracking.
 *
 * A night is filed under the logical day it started in, so a 01:00 bedtime
 * belongs to the day that just ended rather than the one beginning. Waking up
 * attaches to the night still open, not to whatever day it is now.
 */
import type { DateStr, Millis, SleepSession } from '@shared/types'
import { addDays, dateStrInZone, rangeDates, wallMinutes } from '@shared/time'
import { readSettings } from '../db/settings'
import * as sleepRepo from '../db/repo/sleep'
import { currentDate, isSleepOnTarget, GuardError } from './dayService'

export function goingToSleep(now: Millis = Date.now()): SleepSession {
  return sleepRepo.setSleepAt(currentDate(now), now)
}

/**
 * Records waking up. Finds the night that has a bedtime but no wake time; if
 * there is none, opens a record on the current day so the time is not lost.
 */
export function wokeUp(now: Millis = Date.now()): SleepSession {
  const open = sleepRepo.getOpenSleep()
  const date = open?.date ?? currentDate(now)
  if (open && open.sleepAt != null && now < open.sleepAt) {
    throw new GuardError('That wake time is before the recorded bedtime.')
  }
  return sleepRepo.setWakeAt(date, now)
}

export function getForDate(date: DateStr): SleepSession | null {
  return sleepRepo.getSleepByDate(date)
}

export function getOpen(): SleepSession | null {
  return sleepRepo.getOpenSleep()
}

/** Manual correction, for the nights where a button went unpressed. */
export function editSleep(
  date: DateStr,
  patch: { sleepAt?: Millis | null; wakeAt?: Millis | null; note?: string | null }
): SleepSession {
  const merged = { ...sleepRepo.getSleepByDate(date), ...patch }
  if (merged.sleepAt != null && merged.wakeAt != null && merged.wakeAt < merged.sleepAt) {
    throw new GuardError('Wake time cannot be before bedtime.')
  }
  return sleepRepo.updateSleep(date, patch)
}

export function clearSleep(date: DateStr): void {
  sleepRepo.deleteSleep(date)
}

export interface SleepNight {
  date: DateStr
  sleepAt: Millis | null
  wakeAt: Millis | null
  durationMin: number | null
  /** Bedtime as minutes past midnight, shifted so late nights plot above early ones. */
  bedtimePlot: number | null
  wakePlot: number | null
  onTarget: boolean
  note: string | null
}

/**
 * The last `days` nights, gap-filled, ready to chart.
 *
 * Bedtimes are plotted on an 18:00-anchored axis: 23:30 becomes 330 and 01:00
 * becomes 420, so a schedule drifting later reads as a line drifting upward
 * instead of wrapping around midnight.
 */
export function recentNights(days = 30, now: Millis = Date.now()): SleepNight[] {
  const settings = readSettings()
  const today = currentDate(now, settings)
  const from = addDays(today, -(days - 1))
  const stored = new Map(sleepRepo.listSleepInRange(from, today).map((s) => [s.date, s]))

  return rangeDates(from, today).map((date) => {
    const s = stored.get(date) ?? null
    const durationMin =
      s?.sleepAt != null && s?.wakeAt != null ? Math.round((s.wakeAt - s.sleepAt) / 60_000) : null
    return {
      date,
      sleepAt: s?.sleepAt ?? null,
      wakeAt: s?.wakeAt ?? null,
      durationMin,
      bedtimePlot: s?.sleepAt != null ? anchor18h(wallMinutes(s.sleepAt, settings.timezone)) : null,
      wakePlot: s?.wakeAt != null ? wallMinutes(s.wakeAt, settings.timezone) : null,
      onTarget: isSleepOnTarget(s, settings),
      note: s?.note ?? null
    }
  })
}

/** Maps a clock minute onto an axis that starts at 18:00 the previous evening. */
function anchor18h(minutes: number): number {
  const shifted = minutes - 18 * 60
  return shifted < 0 ? shifted + 1440 : shifted
}

export interface SleepSummary {
  avgDurationMin: number | null
  avgBedtimePlot: number | null
  nightsOnTarget: number
  nightsRecorded: number
}

export function summarize(nights: SleepNight[]): SleepSummary {
  const withDuration = nights.filter((n) => n.durationMin != null)
  const withBed = nights.filter((n) => n.bedtimePlot != null)
  const mean = (xs: number[]) =>
    xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null
  return {
    avgDurationMin: mean(withDuration.map((n) => n.durationMin!)),
    avgBedtimePlot: mean(withBed.map((n) => n.bedtimePlot!)),
    nightsOnTarget: nights.filter((n) => n.onTarget).length,
    nightsRecorded: withDuration.length
  }
}

/** Which logical day a manually entered instant belongs to. */
export function dateForInstant(ms: Millis, now: Millis = Date.now()): DateStr {
  const settings = readSettings()
  return dateStrInZone(ms, settings.timezone) === currentDate(now, settings)
    ? currentDate(now, settings)
    : currentDate(ms, settings)
}
