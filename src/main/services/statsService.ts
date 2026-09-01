/**
 * Stats. Everything here is derived on read — no aggregate tables to fall out
 * of sync with the logs they summarise.
 */
import type { DateStr, Millis, StreakInfo } from '@shared/types'
import { addDays, daysBetween, rangeDates } from '@shared/time'
import { readSettings } from '../db/settings'
import { currentDate, scoreFor, getPrayerStatuses, isPerfectPrayerDay } from './dayService'
import { warmRange } from './prayerTimes'
import { avoidCleanDays, avoidStreak, habitStreak, perfectPrayerStreak } from './streaksService'
import { appliesOnWeekday } from '@shared/streaks'
import { weekdayOf } from '@shared/time'
import * as habitsRepo from '../db/repo/habits'
import * as avoidRepo from '../db/repo/avoid'
import * as workRepo from '../db/repo/work'
import * as prayersRepo from '../db/repo/prayers'

/** The first day with any recorded activity, or today if the app is brand new. */
export function historyStart(now: Millis = Date.now()): DateStr {
  const today = currentDate(now)
  const candidates = [
    prayersRepo.earliestMarkDate(),
    habitsRepo.earliestHabitLogDate(),
    avoidRepo.earliestAvoidLogDate(),
    workRepo.earliestWorkDate()
  ].filter((d): d is DateStr => d != null)
  const earliest = candidates.length ? candidates.sort()[0] : today
  const start = readSettings().trackingStartDate
  return start && start > earliest ? start : earliest
}

export interface DailyPoint {
  date: DateStr
  score: number
  prayersDone: number
  habitsDone: number
  habitsApplicable: number
  /** 0..1, or null on a day with no applicable habits. */
  habitRatio: number | null
  workSeconds: number
}

/** The per-day series every chart on the stats page is built from. */
export function dailySeries(days: number, now: Millis = Date.now()): DailyPoint[] {
  const settings = readSettings()
  const today = currentDate(now, settings)
  // Never reach back past the first day the app was responsible for.
  const requested = addDays(today, -(days - 1))
  const from =
    settings.trackingStartDate && settings.trackingStartDate > requested
      ? settings.trackingStartDate
      : requested
  if (daysBetween(from, today) < 0) return []
  warmRange(from, today, settings)

  const habits = habitsRepo.listHabits(true)
  const habitLogs = habitsRepo.getHabitLogs(from, today)
  const doneByDate = new Map<DateStr, Set<number>>()
  for (const log of habitLogs) {
    if (log.done !== 1) continue
    const set = doneByDate.get(log.date) ?? new Set<number>()
    set.add(log.habit_id)
    doneByDate.set(log.date, set)
  }

  const workByDate = new Map<DateStr, number>()
  for (const s of workRepo.listWorkInRange(from, today)) {
    workByDate.set(s.date, (workByDate.get(s.date) ?? 0) + s.durationSec)
  }

  return rangeDates(from, today).map((date) => {
    const weekday = weekdayOf(date)
    const applicable = habits.filter(
      (h) => !h.archived && appliesOnWeekday(h.daysMask, weekday)
    )
    const done = doneByDate.get(date) ?? new Set<number>()
    const habitsDone = applicable.filter((h) => done.has(h.id)).length
    return {
      date,
      score: scoreFor(date, now, settings).total,
      prayersDone: getPrayerStatuses(date, now, settings).filter((s) => s.state === 'done').length,
      habitsDone,
      habitsApplicable: applicable.length,
      habitRatio: applicable.length ? habitsDone / applicable.length : null,
      workSeconds: workByDate.get(date) ?? 0
    }
  })
}

export interface PrayerRatePoint {
  /** ISO week start, or month for the coarser view. */
  bucket: DateStr
  done: number
  possible: number
  rate: number
}

/** Prayer completion rate bucketed by week, from a daily series. */
export function prayerRateByWeek(series: DailyPoint[]): PrayerRatePoint[] {
  const buckets = new Map<DateStr, { done: number; possible: number }>()
  for (const point of series) {
    const key = startOfWeekKey(point.date)
    const b = buckets.get(key) ?? { done: 0, possible: 0 }
    b.done += point.prayersDone
    b.possible += 5
    buckets.set(key, b)
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, b]) => ({ bucket, ...b, rate: b.possible ? b.done / b.possible : 0 }))
}

function startOfWeekKey(date: DateStr): DateStr {
  const wd = weekdayOf(date)
  return addDays(date, wd === 0 ? -6 : 1 - wd)
}

export interface HeatmapCell {
  date: DateStr
  /** 0..1 completion across applicable habits, or null when none applied. */
  value: number | null
  inFuture: boolean
}

/** GitHub-style contribution grid over habit completion. */
export function habitHeatmap(days = 182, now: Millis = Date.now()): HeatmapCell[] {
  const today = currentDate(now)
  return dailySeries(days, now).map((p) => ({
    date: p.date,
    value: p.habitRatio,
    inFuture: daysBetween(today, p.date) > 0
  }))
}

export interface HabitStat {
  id: number
  name: string
  streak: StreakInfo
  completions: number
  applicableDays: number
  rate: number
}

export function habitStats(days = 365, now: Millis = Date.now()): HabitStat[] {
  const settings = readSettings()
  const today = currentDate(now, settings)
  // Days before the app existed must not count against a habit's rate.
  const requested = addDays(today, -(days - 1))
  const from =
    settings.trackingStartDate && settings.trackingStartDate > requested
      ? settings.trackingStartDate
      : requested
  const ctx = { today, tz: settings.timezone }

  return habitsRepo.listHabits().map((habit) => {
    const logs = habitsRepo.getHabitLogsFor(habit.id, from, today)
    const completions = logs.filter((l) => l.done === 1).length
    const applicableDays = rangeDates(from, today).filter((d) =>
      appliesOnWeekday(habit.daysMask, weekdayOf(d))
    ).length
    return {
      id: habit.id,
      name: habit.name,
      streak: habitStreak(habit, today, ctx),
      completions,
      applicableDays,
      rate: applicableDays ? completions / applicableDays : 0
    }
  })
}

export interface AvoidStat {
  id: number
  name: string
  streak: StreakInfo
  cleanDays: number
  slipDays: number
  isQuitTracker: boolean
}

export function avoidStats(now: Millis = Date.now()): AvoidStat[] {
  const settings = readSettings()
  const today = currentDate(now, settings)
  const ctx = { today, tz: settings.timezone }

  return avoidRepo.listAvoidItems().map((item) => {
    const logs = avoidRepo.getAvoidLogsFor(item.id, '0000-01-01', today)
    return {
      id: item.id,
      name: item.name,
      streak: avoidStreak(item, today, ctx),
      cleanDays: avoidCleanDays(item, today, ctx),
      slipDays: logs.filter((l) => l.status === 'slip').length,
      isQuitTracker: item.isQuitTracker
    }
  })
}

/** Consecutive logical days with all five prayers done in time. */
export function fiveOfFiveStreak(now: Millis = Date.now()): StreakInfo {
  const settings = readSettings()
  const today = currentDate(now, settings)
  const from = historyStart(now)
  warmRange(from, today, settings)
  return perfectPrayerStreak(
    (date) => isPerfectPrayerDay(date, now, settings),
    today,
    { today, tz: settings.timezone },
    from
  )
}

export interface StatsOverview {
  from: DateStr
  to: DateStr
  series: DailyPoint[]
  prayerRate: PrayerRatePoint[]
  heatmap: HeatmapCell[]
  habits: HabitStat[]
  avoid: AvoidStat[]
  fiveOfFive: StreakInfo
  totals: {
    daysTracked: number
    avgScore: number
    prayersDone: number
    prayersPossible: number
    focusedHours: number
  }
}

export function statsOverview(days = 90, now: Millis = Date.now()): StatsOverview {
  const series = dailySeries(days, now)
  const prayersDone = series.reduce((s, p) => s + p.prayersDone, 0)
  const focusedSeconds = series.reduce((s, p) => s + p.workSeconds, 0)
  const avg = series.length
    ? Math.round(series.reduce((s, p) => s + p.score, 0) / series.length)
    : 0

  return {
    from: series[0]?.date ?? currentDate(now),
    to: series[series.length - 1]?.date ?? currentDate(now),
    series,
    prayerRate: prayerRateByWeek(series),
    heatmap: habitHeatmap(Math.max(days, 182), now),
    habits: habitStats(Math.max(days, 90), now),
    avoid: avoidStats(now),
    fiveOfFive: fiveOfFiveStreak(now),
    totals: {
      daysTracked: series.length,
      avgScore: avg,
      prayersDone,
      prayersPossible: series.length * 5,
      focusedHours: Math.round((focusedSeconds / 3600) * 10) / 10
    }
  }
}
