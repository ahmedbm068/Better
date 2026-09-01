/**
 * The background tick.
 *
 * One timer drives everything time-dependent: notifications, the tray tooltip,
 * the day rollover, the forgotten-session prompt and the Sunday review nudge.
 * The renderer is told when something changed rather than polling for it.
 */
import { powerMonitor } from 'electron'
import { syncNow } from './syncService'
import type { DateStr, Millis } from '@shared/types'
import { PRAYER_LABELS } from '@shared/types'
import { formatDurationShort } from '@shared/format'
import { currentWindow, nextWindow } from '@shared/prayer'
import { readSettings } from '../db/settings'
import { currentDate, getPrayerStatuses } from './dayService'
import { runningTooLong } from './workService'
import { isReviewDue } from './reviewService'
import {
  notifyLongSession,
  notifyReviewDue,
  pruneOldNotifications,
  runPrayerNotifications
} from './notifications'

const TICK_MS = 15_000

export interface SchedulerHooks {
  /** Tray tooltip text; null when no window is currently open. */
  onTooltip: (text: string) => void
  /** Broadcast to the renderer so it can refetch. */
  onEvent: (channel: string, payload?: unknown) => void
}

let timer: NodeJS.Timeout | null = null
let lastDate: DateStr | null = null
let longSessionPromptedFor: number | null = null
let reviewPrompted: DateStr | null = null

export function startScheduler(hooks: SchedulerHooks): void {
  stopScheduler()
  tick(hooks)
  timer = setInterval(() => tick(hooks), TICK_MS)

  // Waking from sleep can skip hours; catch up immediately rather than at the
  // next tick, so a rollover that happened while suspended lands right away.
  powerMonitor.on('resume', () => tick(hooks))
  powerMonitor.on('unlock-screen', () => tick(hooks))

  // Waking is the moment a device is most likely to have missed changes and to
  // have a network again, so it is worth a cycle even off the normal interval.
  powerMonitor.on('resume', () => {
    void syncNow(() => hooks.onEvent('data:changed'))
  })
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}

/** Runs one full pass. Safe to call at any time; every step is idempotent. */
export function tick(hooks: SchedulerHooks, now: Millis = Date.now()): void {
  let settings
  try {
    settings = readSettings()
  } catch {
    return // Database not open yet (very early startup, or shutting down).
  }

  const date = currentDate(now, settings)

  // The logical day rolled over. Windows that closed unchecked are already
  // missed by definition — there is nothing to write, only a UI to refresh.
  if (lastDate !== null && lastDate !== date) {
    hooks.onEvent('day:rollover', { from: lastDate, to: date })
    longSessionPromptedFor = null
    pruneOldNotifications(now)
  }
  lastDate = date

  try {
    runPrayerNotifications(now, settings)
  } catch {
    // A notification failure must never stop the clock.
  }

  hooks.onTooltip(tooltipText(date, now, settings))
  hooks.onEvent('tick', { now, date })

  const forgotten = runningTooLong()
  if (forgotten && longSessionPromptedFor !== forgotten.id) {
    longSessionPromptedFor = forgotten.id
    notifyLongSession(forgotten.project, Math.floor(forgotten.durationSec / 3600))
    hooks.onEvent('work:long-session', forgotten)
  }
  if (!forgotten) longSessionPromptedFor = null

  if (isReviewDue(now) && reviewPrompted !== date) {
    reviewPrompted = date
    notifyReviewDue()
    hooks.onEvent('review:due', { date })
  }
}

/** "Asr — 1h 42m left", or the wait until the next window opens. */
export function tooltipText(date: DateStr, now: Millis, settings = readSettings()): string {
  const statuses = getPrayerStatuses(date, now, settings)
  const open = currentWindow(statuses, now)
  if (open) {
    const label = PRAYER_LABELS[open.prayer]
    return open.state === 'done'
      ? `Better — ${label} done`
      : `Better — ${label} ${formatDurationShort(open.msLeft)} left`
  }
  const next = nextWindow(statuses, now)
  if (next) {
    return `Better — ${PRAYER_LABELS[next.prayer]} in ${formatDurationShort(next.start - now)}`
  }
  return 'Better'
}
