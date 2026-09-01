/**
 * Desktop notifications for prayer windows.
 *
 * Three moments per prayer, all suppressible from Settings: the window opening,
 * then each configured lead time before it closes. Every one is deduped through
 * the database, so a restart cannot make a reminder fire twice.
 *
 * Nothing here scolds. A closed window produces no notification at all.
 */
import { Notification } from 'electron'
import type { Millis, PrayerStatus, Settings } from '@shared/types'
import { PRAYER_LABELS } from '@shared/types'
import { formatDurationShort } from '@shared/format'
import { MINUTE } from '@shared/time'
import { markNotificationSent, pruneNotificationLog, wasNotificationSent } from '../db/repo/misc'
import { currentDate, getPrayerStatuses } from './dayService'
import { readSettings } from '../db/settings'

/**
 * How late an "opened" notification may still be useful. Past this the moment
 * is silently marked as handled instead of firing on launch hours later.
 */
const OPEN_GRACE_MS = 10 * MINUTE

function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return
  new Notification({ title, body, silent: false }).show()
}

/** Fires at most one notification per prayer per tick. */
export function runPrayerNotifications(now: Millis = Date.now(), settings: Settings = readSettings()): void {
  const date = currentDate(now, settings)
  const statuses = getPrayerStatuses(date, now, settings)
  for (const status of statuses) handlePrayer(date, status, now, settings)
}

function handlePrayer(
  date: string,
  status: PrayerStatus,
  now: Millis,
  settings: Settings
): void {
  const label = PRAYER_LABELS[status.prayer]
  const key = (moment: string) => `${date}:${status.prayer}:${moment}`

  // A prayed or not-yet-open prayer has nothing to say. A made-up one already
  // went through `missed` on an earlier tick, so its reminders are long silent.
  if (status.state === 'done' || status.state === 'late') return
  if (status.state === 'missed') {
    // Close out the day's pending reminders quietly, with no notification.
    silence(key('open'))
    for (const lead of settings.notifyLeadMinutes) silence(key(`lead-${lead}`))
    return
  }
  if (status.state === 'upcoming') return

  const sinceOpen = now - status.start
  if (!wasNotificationSent(key('open'))) {
    if (settings.notifyOnWindowOpen && sinceOpen <= OPEN_GRACE_MS) {
      notify(`${label} — window open`, `${formatDurationShort(status.msLeft)} left.`)
    }
    markNotificationSent(key('open'))
  }

  // Only the tightest lead that currently applies fires; wider ones that were
  // missed (app closed, machine asleep) are marked handled so they stay quiet.
  const leads = [...settings.notifyLeadMinutes].sort((a, b) => a - b)
  const applicable = leads.find((lead) => status.msLeft <= lead * MINUTE)
  if (applicable === undefined) return

  if (!wasNotificationSent(key(`lead-${applicable}`))) {
    notify(`${label} — ${formatDurationShort(status.msLeft)} left`, 'Still unchecked.')
    markNotificationSent(key(`lead-${applicable}`))
  }
  for (const lead of leads) {
    if (lead >= applicable) silence(key(`lead-${lead}`))
  }
}

function silence(key: string): void {
  if (!wasNotificationSent(key)) markNotificationSent(key)
}

/** A plain, factual nudge when a session looks forgotten. */
export function notifyLongSession(project: string, hours: number): void {
  notify('Session still running', `"${project}" has been running for ${hours}h.`)
}

export function notifyReviewDue(): void {
  notify('Weekly review', 'The week is done. Open the review when you are ready.')
}

/** Keeps the dedupe table small — 90 days is far more than it needs. */
export function pruneOldNotifications(now: Millis = Date.now()): void {
  pruneNotificationLog(now - 90 * 24 * 3_600_000)
}
