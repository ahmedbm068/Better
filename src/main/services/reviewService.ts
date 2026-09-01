/** The weekly review: aggregate the week, then let it be annotated. */
import type { DateStr, Millis, WeeklyReview, WeekStats } from '@shared/types'
import { addDays, daysBetween, endOfWeek, startOfWeek, wallMinutes } from '@shared/time'
import { readSettings } from '../db/settings'
import { currentDate, isTracked, scoreFor, getPrayerStatuses } from './dayService'
import { warmRange } from './prayerTimes'
import { countDone, countLate } from '@shared/prayer'
import { avoidStreak, habitStreak } from './streaksService'
import * as habitsRepo from '../db/repo/habits'
import * as avoidRepo from '../db/repo/avoid'
import * as workRepo from '../db/repo/work'
import * as sleepRepo from '../db/repo/sleep'
import * as miscRepo from '../db/repo/misc'
import { rangeDates } from '@shared/time'

export function weekStats(anchor: DateStr, now: Millis = Date.now()): WeekStats {
  const settings = readSettings()
  const today = currentDate(now, settings)
  const weekStart = startOfWeek(anchor)
  const weekEnd = endOfWeek(anchor)
  // Never score days that have not happened yet.
  const last = daysBetween(weekEnd, today) < 0 ? today : weekEnd
  const dates =
    daysBetween(weekStart, last) < 0
      ? []
      : rangeDates(weekStart, last).filter((d) => isTracked(d, settings))
  if (dates.length > 0) warmRange(dates[0], last, settings)

  const days = dates.map((date) => ({ date, score: scoreFor(date, now, settings).total }))
  const prayerDays = dates.map((date) => getPrayerStatuses(date, now, settings))
  const prayersDone = prayerDays.reduce((sum, st) => sum + countDone(st), 0)
  const prayersLate = prayerDays.reduce((sum, st) => sum + countLate(st), 0)
  const prayersPossible = dates.length * 5

  const sleeps = sleepRepo
    .listSleepInRange(weekStart, last)
    .filter((s) => s.sleepAt != null && s.wakeAt != null)
  const avgSleepHours = sleeps.length
    ? sleeps.reduce((sum, s) => sum + (s.wakeAt! - s.sleepAt!) / 3_600_000, 0) / sleeps.length
    : 0

  const focusedHours = workRepo.secondsInRange(weekStart, last) / 3600
  const sorted = [...days].sort((a, b) => b.score - a.score)
  const ctx = { today, tz: settings.timezone }

  const longestStreaks = [
    ...habitsRepo.listHabits().map((h) => ({ name: h.name, ...habitStreak(h, last, ctx) })),
    ...avoidRepo.listAvoidItems().map((i) => ({ name: i.name, ...avoidStreak(i, last, ctx) }))
  ]
    .map((s) => ({ name: s.name, current: s.current, record: s.record }))
    .sort((a, b) => b.current - a.current)
    .slice(0, 6)

  return {
    weekStart,
    weekEnd,
    avgScore: days.length ? Math.round(days.reduce((s, d) => s + d.score, 0) / days.length) : 0,
    prayerRate: prayersPossible ? prayersDone / prayersPossible : 0,
    prayersDone,
    prayersLate,
    prayersPossible,
    focusedHours: Math.round(focusedHours * 10) / 10,
    avgSleepHours: Math.round(avgSleepHours * 10) / 10,
    bestDay: sorted[0] ?? null,
    worstDay: sorted.length > 1 ? sorted[sorted.length - 1] : null,
    longestStreaks,
    days
  }
}

export function getReview(weekStart: DateStr): WeeklyReview | null {
  return miscRepo.getReview(startOfWeek(weekStart))
}

export function saveReview(weekStart: DateStr, note: string, fixNext: string): WeeklyReview {
  return miscRepo.saveReview(startOfWeek(weekStart), note, fixNext)
}

export function listReviews(): WeeklyReview[] {
  return miscRepo.listReviews()
}

/**
 * True on Sunday evening, once the day is far enough along to review, and only
 * while this week's review is still unwritten.
 */
export function isReviewDue(now: Millis = Date.now(), fromHour = 18): boolean {
  const settings = readSettings()
  const today = currentDate(now, settings)
  const isSunday = daysBetween(startOfWeek(today), today) === 6
  if (!isSunday) return false
  if (wallMinutes(now, settings.timezone) < fromHour * 60) return false
  return getReview(today) === null
}

/** The week the review screen should open on: the one that just ended, or this one. */
export function reviewAnchor(now: Millis = Date.now()): DateStr {
  const today = currentDate(now)
  return isReviewDue(now) ? startOfWeek(today) : startOfWeek(addDays(today, -7))
}
