/** Month and week views: one compact row per day. */
import type { CalendarDay, DateStr, Millis, PrayerState, ScoreBreakdown } from '@shared/types'
import { addDays, daysBetween, monthGridRange, rangeDates, startOfWeek, weekdayOf } from '@shared/time'
import { appliesOnWeekday } from '@shared/streaks'
import { readSettings } from '../db/settings'
import { currentDate, isTracked, scoreFor, getPrayerStatuses } from './dayService'
import { emptyScore } from '@shared/score'
import { warmRange } from './prayerTimes'
import * as avoidRepo from '../db/repo/avoid'
import * as habitsRepo from '../db/repo/habits'
import * as workRepo from '../db/repo/work'
import * as sleepRepo from '../db/repo/sleep'
import * as miscRepo from '../db/repo/misc'

function buildRange(from: DateStr, to: DateStr, now: Millis): CalendarDay[] {
  const settings = readSettings()
  const today = currentDate(now, settings)
  warmRange(from, to, settings)

  const slipDays = avoidRepo.datesWithSlips(from, to)
  const notes = miscRepo.getDayNotes(from, to)
  const work = workRepo.listWorkInRange(from, to)
  const workByDate = new Map<DateStr, number>()
  for (const w of work) workByDate.set(w.date, (workByDate.get(w.date) ?? 0) + w.durationSec)

  // The pinned quit item earns its mark on any tracked day with no slip.
  const quitItem = avoidRepo.getQuitTrackerItem()
  const quitSlips = new Set(
    quitItem
      ? avoidRepo
          .getAvoidLogsFor(quitItem.id, from, to)
          .filter((l) => l.status === 'slip')
          .map((l) => l.date)
      : []
  )
  const graceDays = new Set(
    habitsRepo
      .getHabitLogs(from, to)
      .filter((l) => l.grace === 1)
      .map((l) => l.date)
  )

  const blank: PrayerState[] = ['upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming']

  return rangeDates(from, to).map((date) => {
    const inFuture = daysBetween(today, date) > 0
    // A day the app never saw is not a day of five missed prayers.
    const tracked = isTracked(date, settings)
    const show = tracked && !inFuture
    const states = show ? getPrayerStatuses(date, now, settings).map((s) => s.state) : blank
    const prayersDone = show ? states.filter((x) => x === 'done').length : 0
    const prayersLate = show ? states.filter((x) => x === 'late').length : 0
    return {
      date,
      inFuture,
      tracked,
      prayerStates: states,
      score: show ? scoreFor(date, now, settings).total : 0,
      hasSlip: slipDays.has(date),
      hasGrace: graceDays.has(date),
      allPrayers: show && prayersDone === 5,
      quitClean: show && quitItem != null && !quitSlips.has(date),
      prayersDone,
      prayersLate,
      workSeconds: workByDate.get(date) ?? 0,
      note: notes.get(date) ?? null
    }
  })
}

export interface MonthView {
  year: number
  month: number
  from: DateStr
  to: DateStr
  today: DateStr
  days: CalendarDay[]
  /** Where history begins, so an untracked month can say so once. */
  trackingStart: DateStr | null
}

export function monthView(year: number, month: number, now: Millis = Date.now()): MonthView {
  const { from, to } = monthGridRange(year, month)
  return {
    year,
    month,
    from,
    to,
    today: currentDate(now),
    days: buildRange(from, to, now),
    trackingStart: readSettings().trackingStartDate
  }
}

export interface WeekViewDay extends CalendarDay {
  habitsDone: number
  habitsApplicable: number
  sleepMinutes: number | null
  /** What the day's points were actually made of, for the stacked bar. */
  breakdown: ScoreBreakdown
  prayers: Array<{ prayer: string; state: PrayerState; start: Millis }>
  habitRows: Array<{ id: number; name: string; done: boolean; grace: boolean; applies: boolean }>
}

export interface WeekView {
  weekStart: DateStr
  weekEnd: DateStr
  today: DateStr
  days: WeekViewDay[]
  /** Last week's totals, so each tile can state a delta rather than a bare figure. */
  previous: { avgScore: number | null; prayersDone: number; workSeconds: number; sleepMin: number | null }
}

/** The same information as the month grid, laid out horizontally with detail. */
export function weekView(anchor: DateStr, now: Millis = Date.now()): WeekView {
  const settings = readSettings()
  const start = startOfWeek(anchor)
  const end = addDays(start, 6)
  const base = buildRange(start, end, now)

  const habits = habitsRepo.listHabits()
  const habitLogs = habitsRepo.getHabitLogs(start, end)
  const notes = miscRepo.getDayNotes(start, end)
  const sleeps = new Map(sleepRepo.listSleepInRange(start, end).map((s) => [s.date, s]))

  const days: WeekViewDay[] = base.map((day) => {
    const applicable = habits.filter((h) => appliesOnWeekday(h.daysMask, weekdayOf(day.date)))
    const dayLogs = habitLogs.filter((l) => l.date === day.date)
    const sleep = sleeps.get(day.date)
    const show = day.tracked && !day.inFuture
    return {
      ...day,
      habitsDone: dayLogs.filter((l) => l.done === 1).length,
      habitsApplicable: applicable.length,
      sleepMinutes:
        sleep?.sleepAt != null && sleep?.wakeAt != null
          ? Math.round((sleep.wakeAt - sleep.sleepAt) / 60_000)
          : null,
      breakdown: show ? scoreFor(day.date, now, settings) : emptyScore(),
      prayers: show
        ? getPrayerStatuses(day.date, now, settings).map((p) => ({
            prayer: p.prayer as string,
            state: p.state,
            start: p.start
          }))
        : [],
      habitRows: habits.map((h) => ({
        id: h.id,
        name: h.name,
        done: dayLogs.some((l) => l.habit_id === h.id && l.done === 1),
        grace: dayLogs.some((l) => l.habit_id === h.id && l.grace === 1),
        applies: appliesOnWeekday(h.daysMask, weekdayOf(day.date))
      })),
      note: notes.get(day.date) ?? null
    }
  })

  // The same shape one week earlier, purely so the tiles can show a delta.
  const prevStart = addDays(start, -7)
  const prevDays = buildRange(prevStart, addDays(start, -1), now).filter(
    (d) => d.tracked && !d.inFuture
  )
  const prevSleeps = sleepRepo
    .listSleepInRange(prevStart, addDays(start, -1))
    .filter((x) => x.sleepAt != null && x.wakeAt != null)

  return {
    weekStart: start,
    weekEnd: end,
    today: currentDate(now, settings),
    days,
    previous: {
      avgScore: prevDays.length
        ? Math.round(prevDays.reduce((s, d) => s + d.score, 0) / prevDays.length)
        : null,
      prayersDone: prevDays.reduce((s, d) => s + d.prayersDone, 0),
      workSeconds: prevDays.reduce((s, d) => s + d.workSeconds, 0),
      sleepMin: prevSleeps.length
        ? Math.round(
            prevSleeps.reduce((s, x) => s + (x.wakeAt! - x.sleepAt!) / 60_000, 0) / prevSleeps.length
          )
        : null
    }
  }
}
