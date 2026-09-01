/**
 * The day: assembling a full snapshot, and the guarded mutations that change it.
 *
 * Guard rules, in one place:
 *   - prayers : on time only inside the window; made up for a short while after
 *   - habits  : the current logical day only (grace also covers yesterday)
 *   - avoid   : the current logical day only
 *   - sleep   : editable after the fact, since the buttons get forgotten
 *   - work    : editable after the fact, for the same reason
 *   - notes   : always editable, on any day
 */
import type {
  AvoidStatus,
  DateStr,
  DaySnapshot,
  Millis,
  PrayerName,
  PrayerStatus,
  ScoreBreakdown,
  Settings,
  SleepSession
} from '@shared/types'
import { logicalDate } from '@shared/day'
import {
  MAKEUP_WINDOW_MS,
  countDone,
  countLate,
  dayStatuses,
  isCheckable,
  isPerfectDay,
  isRecordable,
  windowFor
} from '@shared/prayer'
import { computeScore, emptyScore } from '@shared/score'
import { appliesOnWeekday } from '@shared/streaks'
import {
  addDays,
  clockDistanceMin,
  dateStrInZone,
  daysBetween,
  parseHHMM,
  rangeDates,
  wallMinutes,
  weekdayOf
} from '@shared/time'
import { readSettings, writeSettings } from '../db/settings'
import { getDayTimes, makeFajrResolver } from './prayerTimes'
import * as prayersRepo from '../db/repo/prayers'
import * as habitsRepo from '../db/repo/habits'
import * as avoidRepo from '../db/repo/avoid'
import * as workRepo from '../db/repo/work'
import * as sleepRepo from '../db/repo/sleep'
import * as miscRepo from '../db/repo/misc'
import { avoidStreak, habitStreak, type StreakContext } from './streaksService'

/** A refusal the UI should show as plain text, not as a crash. */
export class GuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GuardError'
  }
}

/** The logical day an instant falls in — rolls over at Fajr, not midnight. */
export function currentDate(now: Millis = Date.now(), settings = readSettings()): DateStr {
  return logicalDate(now, makeFajrResolver(settings), {
    tz: settings.timezone,
    offsetMin: settings.dayStartOffsetMin
  })
}

/**
 * Records the first day the app was responsible for.
 *
 * Without this every day since the epoch would derive as five missed prayers,
 * which is both false and the kind of invented failure this app exists to
 * avoid. Called once, right after the database opens.
 *
 * A database that already holds records predates this setting, so the earliest
 * of those records wins over today — otherwise upgrading would silently mark
 * days you had already tracked as untracked.
 */
export function ensureTrackingStart(now: Millis = Date.now()): DateStr {
  const settings = readSettings()
  if (settings.trackingStartDate) return settings.trackingStartDate

  const today = currentDate(now, settings)
  const recorded = [
    prayersRepo.earliestMarkDate(),
    habitsRepo.earliestHabitLogDate(),
    avoidRepo.earliestAvoidLogDate(),
    workRepo.earliestWorkDate(),
    sleepRepo.earliestSleepDate()
  ].filter((d): d is DateStr => d != null)

  const start = recorded.length ? [...recorded, today].sort()[0] : today
  writeSettings({ trackingStartDate: start })
  return start
}

/** False for days that predate the first run — they are never scored. */
export function isTracked(date: DateStr, settings = readSettings()): boolean {
  return settings.trackingStartDate == null || date >= settings.trackingStartDate
}

export function streakContext(now: Millis = Date.now(), settings = readSettings()): StreakContext {
  return { today: currentDate(now, settings), tz: settings.timezone }
}

export function getPrayerStatuses(
  date: DateStr,
  now: Millis = Date.now(),
  settings = readSettings()
): PrayerStatus[] {
  return dayStatuses(getDayTimes(date, settings), now, prayersRepo.getMarks(date))
}

/** How the make-up limit reads in a refusal, without hardcoding the number. */
const MAKEUP_DAYS = Math.round(MAKEUP_WINDOW_MS / 86_400_000)

/**
 * Records a prayer.
 *
 * Inside its window this is an ordinary check, done in time. After it, and for
 * as long as the make-up window allows, the mark is still written but comes
 * back as `late` — see `statusFor`, which reads that off the time itself. There
 * is no argument here that turns a make-up into an on-time prayer.
 */
export function checkPrayer(
  date: DateStr,
  prayer: PrayerName,
  now: Millis = Date.now()
): PrayerStatus[] {
  const settings = readSettings()
  const window = windowFor(getDayTimes(date, settings), prayer)
  if (!isRecordable(window, now)) {
    throw new GuardError(
      now < window.start
        ? 'That prayer window has not opened yet.'
        : `That window closed more than ${MAKEUP_DAYS} days ago. The record for it is final.`
    )
  }
  prayersRepo.setMark(date, prayer, now)
  return getPrayerStatuses(date, now, settings)
}

/**
 * Undoes a mis-tap.
 *
 * Two separate permissions, not one. While the window is open anything may be
 * withdrawn. Once it has closed, only a *make-up* may be — an on-time prayer
 * becomes part of the record the moment its window ends, and stays there.
 */
export function uncheckPrayer(
  date: DateStr,
  prayer: PrayerName,
  now: Millis = Date.now()
): PrayerStatus[] {
  const settings = readSettings()
  const window = windowFor(getDayTimes(date, settings), prayer)
  const status = getPrayerStatuses(date, now, settings).find((s) => s.prayer === prayer)

  const allowed =
    isCheckable(window, now) || (status?.state === 'late' && status.canMakeUp)
  if (!allowed) {
    throw new GuardError('That window has closed. The record for it is final.')
  }
  prayersRepo.clearMark(date, prayer)
  return getPrayerStatuses(date, now, settings)
}

function assertToday(date: DateStr, now: Millis, what: string): void {
  const today = currentDate(now)
  if (date !== today) {
    throw new GuardError(`${what} can only be changed on the current day (${today}).`)
  }
}

export function setHabitDone(
  date: DateStr,
  habitId: number,
  done: boolean,
  now: Millis = Date.now()
): void {
  assertToday(date, now, 'Habits')
  habitsRepo.setHabitLog(habitId, date, done, false)
}

/**
 * Spends this month's grace day. Allowed on the current day or the one before
 * it, because a broken streak is usually noticed the next morning.
 */
export function useGraceDay(date: DateStr, habitId: number, now: Millis = Date.now()): void {
  const age = daysBetween(date, currentDate(now))
  if (age < 0 || age > 1) {
    throw new GuardError('A grace day can only be used for today or yesterday.')
  }
  if (habitsRepo.graceUsedInMonth(habitId, date.slice(0, 7))) {
    throw new GuardError('This habit has already used its grace day this month.')
  }
  habitsRepo.setHabitLog(habitId, date, false, true)
}

export function clearGraceDay(date: DateStr, habitId: number, now: Millis = Date.now()): void {
  const age = daysBetween(date, currentDate(now))
  if (age < 0 || age > 1) throw new GuardError('That grace day can no longer be changed.')
  habitsRepo.setHabitLog(habitId, date, false, false)
}

export function setAvoidStatus(
  date: DateStr,
  itemId: number,
  status: AvoidStatus | null,
  note: string | null,
  now: Millis = Date.now()
): void {
  assertToday(date, now, 'The avoid list')
  avoidRepo.setAvoidLog(itemId, date, status, note)
}

/** True when both ends of the night landed within tolerance of the targets. */
export function isSleepOnTarget(sleep: SleepSession | null, settings: Settings): boolean {
  if (!sleep?.sleepAt || !sleep?.wakeAt) return false
  const bed = parseHHMM(settings.targetBedtime)
  const wake = parseHHMM(settings.targetWakeTime)
  const tol = settings.sleepTargetToleranceMin
  const bedMin = wallMinutes(sleep.sleepAt, settings.timezone)
  const wakeMin = wallMinutes(sleep.wakeAt, settings.timezone)
  return (
    clockDistanceMin(bedMin, bed.hour * 60 + bed.minute) <= tol &&
    clockDistanceMin(wakeMin, wake.hour * 60 + wake.minute) <= tol
  )
}

/** Habits and avoid items that existed on a given day. */
function activeOn(date: DateStr, tz: string) {
  const habits = habitsRepo.listHabits().filter((h) => dateStrInZone(h.createdAt, tz) <= date)
  const items = avoidRepo.listAvoidItems().filter((i) => dateStrInZone(i.createdAt, tz) <= date)
  return { habits, items }
}

export function scoreFor(
  date: DateStr,
  now: Millis = Date.now(),
  settings = readSettings()
): ScoreBreakdown {
  // A day the app was not watching has no score — not a zero, and not the free
  // marks that empty habit and avoid lists would otherwise hand out.
  if (!isTracked(date, settings)) return emptyScore()

  const statuses = getPrayerStatuses(date, now, settings)
  const { habits, items } = activeOn(date, settings.timezone)

  const weekday = weekdayOf(date)
  const applicable = habits.filter((h) => appliesOnWeekday(h.daysMask, weekday))
  const logs = new Map(habitsRepo.getHabitLogs(date, date).map((l) => [l.habit_id, l]))
  const habitsDone = applicable.filter((h) => logs.get(h.id)?.done === 1).length

  const avoidLogs = new Map(avoidRepo.getAvoidLogs(date, date).map((l) => [l.itemId, l]))
  const avoidClean = items.filter((i) => avoidLogs.get(i.id)?.status !== 'slip').length

  return computeScore({
    prayersDone: countDone(statuses),
    prayersLate: countLate(statuses),
    habitsApplicable: applicable.length,
    habitsDone,
    avoidActive: items.length,
    avoidClean,
    sleepOnTarget: isSleepOnTarget(sleepRepo.getSleepByDate(date), settings),
    hasWorkSession: workRepo.listWorkByDate(date).some((s) => s.durationSec > 0)
  })
}

/** Everything the UI needs to render one day. */
export function buildDaySnapshot(date: DateStr, now: Millis = Date.now()): DaySnapshot {
  const settings = readSettings()
  const today = currentDate(now, settings)
  const ctx: StreakContext = { today, tz: settings.timezone }
  const weekday = weekdayOf(date)

  const window30 = rangeDates(addDays(date, -29), date)
  const logsByHabit = new Map<number, Map<DateStr, { done: number; grace: number }>>()
  for (const log of habitsRepo.getHabitLogs(window30[0], date)) {
    const inner = logsByHabit.get(log.habit_id) ?? new Map()
    inner.set(log.date, { done: log.done, grace: log.grace })
    logsByHabit.set(log.habit_id, inner)
  }

  const month = date.slice(0, 7)
  const habits = habitsRepo.listHabits().map((habit) => {
    const logs = logsByHabit.get(habit.id) ?? new Map()
    const own = logs.get(date)
    const history = window30.map((d) => ({
      date: d,
      applies: appliesOnWeekday(habit.daysMask, weekdayOf(d)),
      done: logs.get(d)?.done === 1,
      grace: logs.get(d)?.grace === 1,
      tracked: isTracked(d, settings)
    }))
    return {
      habit,
      applies: appliesOnWeekday(habit.daysMask, weekday),
      done: own?.done === 1,
      grace: own?.grace === 1,
      streak: habitStreak(habit, date, ctx),
      history,
      monthDone: history.filter((d) => d.date.startsWith(month) && d.done).length,
      monthApplicable: history.filter(
        (d) => d.date.startsWith(month) && d.applies && d.tracked
      ).length
    }
  })

  const avoidLogs = new Map(avoidRepo.getAvoidLogs(date, date).map((l) => [l.itemId, l]))
  const avoid = avoidRepo.listAvoidItems().map((item) => {
    const log = avoidLogs.get(item.id)
    return {
      item,
      status: log?.status ?? null,
      note: log?.note ?? null,
      streak: avoidStreak(item, date, ctx)
    }
  })

  const work = workRepo.listWorkByDate(date)
  const sleep = sleepRepo.getSleepByDate(date)

  return {
    date,
    isToday: date === today,
    isPast: daysBetween(date, today) > 0,
    tracked: isTracked(date, settings),
    prayers: getPrayerStatuses(date, now, settings),
    habits,
    avoid,
    work,
    workSecToday: work.reduce((sum, s) => sum + s.durationSec, 0),
    sleep,
    sleepOnTarget: isSleepOnTarget(sleep, settings),
    score: scoreFor(date, now, settings),
    note: miscRepo.getDayNote(date)
  }
}

export function isPerfectPrayerDay(date: DateStr, now: Millis, settings: Settings): boolean {
  return isPerfectDay(getPrayerStatuses(date, now, settings))
}
