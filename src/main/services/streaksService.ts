/**
 * Streaks over stored history.
 *
 * Builds the day list each item is judged on, then hands it to the pure rules
 * in `@shared/streaks`. Days before an item existed are not counted against it.
 */
import type { AvoidItem, DateStr, Habit, StreakInfo } from '@shared/types'
import type { StreakDay } from '@shared/streaks'
import { appliesOnWeekday, computeStreakInfo } from '@shared/streaks'
import { addDays, dateStrInZone, daysBetween, rangeDates, weekdayOf } from '@shared/time'
import { getHabitLogsFor, graceUsedInMonth } from '../db/repo/habits'
import { getAvoidLogsFor } from '../db/repo/avoid'

/** How far back a streak scan reaches. Well past any realistic run. */
const MAX_HISTORY_DAYS = 3650

function historyStart(createdAt: number, upTo: DateStr, tz: string): DateStr {
  const created = dateStrInZone(createdAt, tz)
  const floor = addDays(upTo, -MAX_HISTORY_DAYS)
  return daysBetween(floor, created) > 0 ? created : floor
}

export interface StreakContext {
  /** The logical day currently in progress — never counted as a failure. */
  today: DateStr
  tz: string
}

export function habitStreakDays(habit: Habit, upTo: DateStr, ctx: StreakContext): StreakDay[] {
  const from = historyStart(habit.createdAt, upTo, ctx.tz)
  if (daysBetween(from, upTo) < 0) return []
  const logs = new Map(
    getHabitLogsFor(habit.id, from, upTo).map((l) => [l.date, l])
  )
  return rangeDates(from, upTo).map((date) => {
    const log = logs.get(date)
    return {
      date,
      applies: appliesOnWeekday(habit.daysMask, weekdayOf(date)),
      done: log?.done === 1,
      grace: log?.grace === 1,
      pending: daysBetween(date, ctx.today) <= 0 && log?.done !== 1
    }
  })
}

export function habitStreak(habit: Habit, upTo: DateStr, ctx: StreakContext): StreakInfo {
  const month = upTo.slice(0, 7)
  return computeStreakInfo(habitStreakDays(habit, upTo, ctx), !graceUsedInMonth(habit.id, month))
}

/**
 * Avoid items are clean by default: a day only counts against you when a slip
 * was actually logged. Nothing is inferred from silence.
 */
export function avoidStreakDays(item: AvoidItem, upTo: DateStr, ctx: StreakContext): StreakDay[] {
  const from = historyStart(item.createdAt, upTo, ctx.tz)
  if (daysBetween(from, upTo) < 0) return []
  const logs = new Map(getAvoidLogsFor(item.id, from, upTo).map((l) => [l.date, l]))
  return rangeDates(from, upTo).map((date) => {
    const slipped = logs.get(date)?.status === 'slip'
    return {
      date,
      applies: true,
      done: !slipped,
      grace: false,
      // Today can still turn into a slip, so it never *ends* a run early — but
      // a slip already logged today does break it immediately.
      pending: false
    }
  })
}

export function avoidStreak(item: AvoidItem, upTo: DateStr, ctx: StreakContext): StreakInfo {
  return computeStreakInfo(avoidStreakDays(item, upTo, ctx))
}

/** Total clean days ever recorded for an avoid item. */
export function avoidCleanDays(item: AvoidItem, upTo: DateStr, ctx: StreakContext): number {
  return avoidStreakDays(item, upTo, ctx).filter((d) => d.done).length
}

/**
 * The 5/5 prayer streak: consecutive logical days on which all five prayers
 * were checked inside their windows.
 */
export function perfectPrayerStreak(
  isPerfect: (date: DateStr) => boolean,
  upTo: DateStr,
  ctx: StreakContext,
  from: DateStr
): StreakInfo {
  const days: StreakDay[] = rangeDates(from, upTo).map((date) => ({
    date,
    applies: true,
    done: isPerfect(date),
    grace: false,
    // The day in progress cannot break the run: some windows are still open.
    pending: date === ctx.today && !isPerfect(date)
  }))
  return computeStreakInfo(days)
}
