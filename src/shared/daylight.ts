/**
 * How much daylight there is, right now, where the user is.
 *
 * This drives the `solar` theme: one number between 0 (night) and 1 (day) that
 * the stylesheet blends the whole palette across. Nothing here knows about
 * colour — it only answers "how light is it outside".
 *
 * The four moments come from the prayer times the app already computes, which
 * are themselves solar events, so the theme follows exactly the same sun the
 * day arc does. No extra astronomy, no clock-of-the-day guessing, and it is
 * correct in Tromsø and Jakarta alike because adhan already handled that.
 */
import type { Millis, PrayerStatus } from './types'

export interface SunTimes {
  /** First light. Fajr begins here. */
  dawn: Millis
  /** The sun clears the horizon. Fajr closes here. */
  sunrise: Millis
  /** The sun goes down. Maghrib begins here. */
  sunset: Millis
  /** The last light has gone. Isha begins here. */
  night: Millis
}

/** Smooth at both ends, so dawn eases in rather than starting with a jolt. */
function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t))
  return x * x * (3 - 2 * x)
}

/**
 * Reads the four solar moments off a day's prayer windows.
 *
 * Returns null when the shape is not what we expect — a caller with no sun to
 * follow should fall back to a fixed theme rather than invent one.
 */
export function sunTimesFromPrayers(prayers: PrayerStatus[]): SunTimes | null {
  const fajr = prayers.find((p) => p.prayer === 'fajr')
  const maghrib = prayers.find((p) => p.prayer === 'maghrib')
  const isha = prayers.find((p) => p.prayer === 'isha')
  if (!fajr || !maghrib || !isha) return null

  const times: SunTimes = {
    dawn: fajr.start,
    sunrise: fajr.end,
    sunset: maghrib.start,
    night: isha.start
  }
  const ordered =
    times.dawn < times.sunrise && times.sunrise < times.sunset && times.sunset < times.night
  return ordered ? times : null
}

/**
 * The daylight fraction at `now`.
 *
 *   before dawn        0     night
 *   dawn → sunrise     0→1   first light coming up
 *   sunrise → sunset   1     day
 *   sunset → night     1→0   dusk falling
 *   after night        0     night again
 *
 * `now` is compared against one calendar day's moments. Past the end of that
 * day it is night, which is the right answer: the small hours after Isha and
 * the small hours before Fajr are the same darkness.
 */
export function daylightAt(now: Millis, sun: SunTimes): number {
  if (now <= sun.dawn || now >= sun.night) return 0
  if (now >= sun.sunrise && now <= sun.sunset) return 1
  if (now < sun.sunrise) return smoothstep((now - sun.dawn) / (sun.sunrise - sun.dawn))
  return smoothstep((sun.night - now) / (sun.night - sun.sunset))
}

export type SunPhase = 'night' | 'dawn' | 'day' | 'dusk'

/** What to call the current moment, for a settings screen that shows its work. */
export function sunPhaseAt(now: Millis, sun: SunTimes): SunPhase {
  if (now <= sun.dawn || now >= sun.night) return 'night'
  if (now < sun.sunrise) return 'dawn'
  if (now <= sun.sunset) return 'day'
  return 'dusk'
}

export const SUN_PHASE_LABELS: Record<SunPhase, string> = {
  night: 'Night',
  dawn: 'Dawn',
  day: 'Daylight',
  dusk: 'Dusk'
}

/**
 * Where the theme sits, as the stylesheet needs it.
 *
 * The obvious implementation of a graded theme — interpolate the dark palette
 * into the light one — cannot work, and it fails in a way that is invisible
 * until you measure it. Light text on a dark ground and dark text on a light
 * ground both pass through the same mid grey halfway across, so at the midpoint
 * the text and the background meet: measured at 1.07:1, which is no contrast at
 * all. Text is unreadable for the middle third of every dawn.
 *
 * So the theme grades *within* a polarity and inverts once. `warm` runs 0 at
 * the extremes of night and day to 1 at the crossing, leaning the ground a little
 * toward the other palette (`--twilight` in the stylesheet) — a night that warms and lifts as
 * dawn comes, a day that dims and cools as dusk falls. `polarity` then flips at
 * the midpoint of the transition, which is roughly when the sun crosses the
 * horizon and when eyes are adapting anyway.
 *
 * Because `warm` peaks on both sides of the flip, the two palettes are as close
 * together as they ever get at the instant they swap. Contrast never drops
 * below about 7:1 anywhere in the range.
 */
export interface ThemePosition {
  /** 0 dark-on-light-text, 1 light-on-dark-text. Steps; never interpolated. */
  polarity: 0 | 1
  /** 0 at deep night or full noon, 1 at the crossing. */
  warm: number
}

export function themePosition(daylight: number): ThemePosition {
  const d = Math.max(0, Math.min(1, daylight))
  const polarity: 0 | 1 = d >= 0.5 ? 1 : 0
  const warm = polarity === 1 ? (1 - d) * 2 : d * 2
  return { polarity, warm: Math.max(0, Math.min(1, warm)) }
}
