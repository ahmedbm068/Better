/**
 * The pinned quit counter.
 *
 * Days since the quit date, and what those days would otherwise have cost.
 * Plain arithmetic on numbers the user entered — nothing is estimated for them.
 */
import type { Millis, QuitStats } from '@shared/types'
import { daysBetween } from '@shared/time'
import { readSettings } from '../db/settings'
import { getQuitTrackerItem } from '../db/repo/avoid'
import { currentDate } from './dayService'
import { avoidStreak } from './streaksService'

export function quitStats(now: Millis = Date.now()): QuitStats {
  const settings = readSettings()
  const today = currentDate(now, settings)
  const item = getQuitTrackerItem()

  // Day 0 is the quit day itself, so a same-day quit reads as 0 days, not 1.
  const days = settings.quitDate ? Math.max(0, daysBetween(settings.quitDate, today)) : 0
  const cigarettesAvoided = days * settings.cigarettesPerDay
  const moneySaved =
    settings.cigarettesPerPack > 0
      ? (cigarettesAvoided / settings.cigarettesPerPack) * settings.pricePerPack
      : 0

  return {
    itemId: item?.id ?? null,
    quitDate: settings.quitDate,
    days,
    cigarettesAvoided,
    moneySaved: Math.round(moneySaved * 100) / 100,
    currency: settings.currency,
    streak: item
      ? avoidStreak(item, today, { today, tz: settings.timezone })
      : { current: 0, record: 0 }
  }
}
