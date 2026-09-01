/** Work session timer. One session runs at a time. */
import type { DateStr, Millis, WorkSession } from '@shared/types'
import { addDays, rangeDates, startOfWeek } from '@shared/time'
import { readSettings } from '../db/settings'
import * as workRepo from '../db/repo/work'
import { currentDate, GuardError } from './dayService'

export function startSession(project: string, now: Millis = Date.now()): WorkSession {
  const running = workRepo.getRunningSession()
  if (running) throw new GuardError(`"${running.project}" is already running. Stop it first.`)
  const name = project.trim()
  if (!name) throw new GuardError('Give the session a name.')
  return workRepo.startWork(currentDate(now), name, now)
}

export function stopSession(note: string | null, now: Millis = Date.now()): WorkSession {
  const running = workRepo.getRunningSession()
  if (!running) throw new GuardError('No session is running.')
  return workRepo.stopWork(running.id, now, note)!
}

export function getRunning(): WorkSession | null {
  return workRepo.getRunningSession()
}

/**
 * A session running longer than the configured limit is probably one someone
 * forgot to stop. The scheduler uses this to ask rather than to guess.
 */
export function runningTooLong(): WorkSession | null {
  const running = workRepo.getRunningSession()
  if (!running) return null
  const limitSec = readSettings().longSessionWarnHours * 3600
  return running.durationSec >= limitSec ? running : null
}

/** Ends a forgotten session at a chosen instant, e.g. when it was last plausible. */
export function discardRunning(endedAt: Millis | null, now: Millis = Date.now()): void {
  const running = workRepo.getRunningSession()
  if (!running) return
  if (endedAt === null) {
    workRepo.deleteWorkSession(running.id)
    return
  }
  workRepo.stopWork(running.id, Math.min(endedAt, now), running.note)
}

export function listProjects(): string[] {
  return workRepo.listProjects()
}

export function sessionsForDate(date: DateStr): WorkSession[] {
  return workRepo.listWorkByDate(date)
}

export function secondsToday(now: Millis = Date.now()): number {
  return workRepo.secondsOnDate(currentDate(now))
}

export function secondsThisWeek(now: Millis = Date.now()): number {
  const today = currentDate(now)
  return workRepo.secondsInRange(startOfWeek(today), today)
}

export interface ProjectTotals {
  from: DateStr
  to: DateStr
  totals: Array<{ project: string; seconds: number }>
  totalSeconds: number
}

export function projectTotals(from: DateStr, to: DateStr): ProjectTotals {
  const totals = workRepo.projectTotals(from, to)
  return { from, to, totals, totalSeconds: totals.reduce((s, t) => s + t.seconds, 0) }
}

/** Per-bucket totals for the stats bars: `weeks` or `months` back from today. */
export function totalsByBucket(
  unit: 'week' | 'month',
  buckets: number,
  now: Millis = Date.now()
): Array<{ bucket: string; seconds: number; byProject: Array<{ project: string; seconds: number }> }> {
  const today = currentDate(now)
  const out: Array<{
    bucket: string
    seconds: number
    byProject: Array<{ project: string; seconds: number }>
  }> = []

  for (let i = buckets - 1; i >= 0; i--) {
    let from: DateStr
    let to: DateStr
    let label: string
    if (unit === 'week') {
      const start = addDays(startOfWeek(today), -7 * i)
      from = start
      to = addDays(start, 6)
      label = start
    } else {
      const [y, m] = today.split('-').map(Number)
      const monthIndex = m - 1 - i
      const year = y + Math.floor(monthIndex / 12)
      const month = ((monthIndex % 12) + 12) % 12
      const first = `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-01`
      const daysIn = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
      from = first
      to = `${first.slice(0, 8)}${String(daysIn).padStart(2, '0')}`
      label = first.slice(0, 7)
    }
    const byProject = workRepo.projectTotals(from, to)
    out.push({ bucket: label, seconds: byProject.reduce((s, t) => s + t.seconds, 0), byProject })
  }
  return out
}

/** Focused seconds per day across a range — feeds the trend charts. */
export function dailySeconds(from: DateStr, to: DateStr): Array<{ date: DateStr; seconds: number }> {
  const sessions = workRepo.listWorkInRange(from, to)
  const totals = new Map<DateStr, number>()
  for (const s of sessions) totals.set(s.date, (totals.get(s.date) ?? 0) + s.durationSec)
  return rangeDates(from, to).map((date) => ({ date, seconds: totals.get(date) ?? 0 }))
}

export const updateSession = workRepo.updateWorkSession
export const deleteSession = workRepo.deleteWorkSession
