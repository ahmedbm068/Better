/**
 * Prayer time calculation.
 *
 * Times are computed with `adhan` and then *snapshotted* into the database the
 * first time a day is touched. History therefore never moves: changing the
 * coordinates or the calculation method affects today and the future only.
 */
import * as adhan from 'adhan'
import type { CalcMethod, DateStr, DayPrayerTimes, Millis, Settings } from '@shared/types'
import type { FajrResolver } from '@shared/day'
import { addDays, rangeDates, zonedTimeToMs } from '@shared/time'
import { getTimesRow, putTimesRow, invalidateTimesFrom, type PrayerTimesRow } from '../db/repo/prayers'

function paramsFor(settings: Settings): adhan.CalculationParameters {
  const methods: Record<CalcMethod, () => adhan.CalculationParameters> = {
    MuslimWorldLeague: adhan.CalculationMethod.MuslimWorldLeague,
    UmmAlQura: adhan.CalculationMethod.UmmAlQura,
    Egyptian: adhan.CalculationMethod.Egyptian,
    Karachi: adhan.CalculationMethod.Karachi
  }
  const params = (methods[settings.calcMethod] ?? adhan.CalculationMethod.MuslimWorldLeague)()
  params.madhab = settings.madhab === 'hanafi' ? adhan.Madhab.Hanafi : adhan.Madhab.Shafi
  return params
}

/**
 * Runs adhan for one calendar date.
 *
 * adhan reads the *local* Y/M/D components of the Date it is given, so the date
 * is built at local noon: that pins the intended calendar day no matter which
 * zone the machine is in.
 */
export function calcTimes(date: DateStr, settings: Settings): PrayerTimesRow {
  const [y, m, d] = date.split('-').map(Number)
  const anchor = new Date(y, m - 1, d, 12, 0, 0, 0)
  const coords = new adhan.Coordinates(settings.latitude, settings.longitude)
  const times = new adhan.PrayerTimes(coords, anchor, paramsFor(settings))

  // A polar day can leave adhan without a valid instant; fall back to plain
  // clock times so the app stays usable rather than crashing on NaN.
  const at = (value: Date, fallbackHour: number): Millis => {
    const ms = value?.getTime?.()
    return Number.isFinite(ms) ? ms : zonedTimeToMs(date, fallbackHour, 0, settings.timezone)
  }

  return {
    date,
    fajr: at(times.fajr, 5),
    sunrise: at(times.sunrise, 7),
    dhuhr: at(times.dhuhr, 12),
    asr: at(times.asr, 15),
    maghrib: at(times.maghrib, 18),
    isha: at(times.isha, 20),
    latitude: settings.latitude,
    longitude: settings.longitude,
    method: settings.calcMethod,
    madhab: settings.madhab,
    tz: settings.timezone,
    computed_at: Date.now()
  }
}

/** Reads the snapshot for a date, computing and storing it on first touch. */
export function ensureTimesRow(date: DateStr, settings: Settings): PrayerTimesRow {
  const cached = getTimesRow(date)
  if (cached) return cached
  const fresh = calcTimes(date, settings)
  putTimesRow(fresh)
  return fresh
}

/** The five windows' bounding instants for a logical day, Isha included. */
export function getDayTimes(date: DateStr, settings: Settings): DayPrayerTimes {
  const today = ensureTimesRow(date, settings)
  const tomorrow = ensureTimesRow(addDays(date, 1), settings)
  return {
    date,
    fajr: today.fajr,
    sunrise: today.sunrise,
    dhuhr: today.dhuhr,
    asr: today.asr,
    maghrib: today.maghrib,
    isha: today.isha,
    nextFajr: tomorrow.fajr
  }
}

/** A Fajr lookup for the rollover logic, memoised for the duration of a call. */
export function makeFajrResolver(settings: Settings): FajrResolver {
  const cache = new Map<DateStr, Millis>()
  return (date: DateStr) => {
    let ms = cache.get(date)
    if (ms === undefined) {
      ms = ensureTimesRow(date, settings).fajr
      cache.set(date, ms)
    }
    return ms
  }
}

/**
 * Discards snapshots from `date` onward so new settings take effect going
 * forward. Days already lived keep the times they were actually judged against.
 */
export function invalidateFrom(date: DateStr): number {
  return invalidateTimesFrom(date)
}

/**
 * Precomputes a window of days so the calendar and stats views never stall.
 * Reaches one day past `to`, because the last day's Isha needs the next Fajr.
 */
export function warmRange(from: DateStr, to: DateStr, settings: Settings): void {
  for (const date of rangeDates(from, addDays(to, 1))) ensureTimesRow(date, settings)
}
