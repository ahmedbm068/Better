/** Types shared across main, preload and renderer. No runtime imports here. */

export const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const
export type PrayerName = (typeof PRAYERS)[number]

export const PRAYER_LABELS: Record<PrayerName, string> = {
  fajr: 'Fajr',
  dhuhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha'
}

/** A local calendar date, `YYYY-MM-DD`. Always the *logical* day (see day.ts). */
export type DateStr = string

/** Epoch milliseconds. */
export type Millis = number

/**
 * `done` means prayed inside its own window. `late` means prayed after it
 * closed — a make-up, which counts as prayed but never as on time. The two are
 * kept apart everywhere, because collapsing them would let a bad day be tidied
 * up after the fact.
 */
export type PrayerState = 'upcoming' | 'open' | 'done' | 'missed' | 'late'

/** The six adhan instants that bound the five prayer windows. */
export interface DayPrayerTimes {
  date: DateStr
  fajr: Millis
  sunrise: Millis
  dhuhr: Millis
  asr: Millis
  maghrib: Millis
  isha: Millis
  /** Next day's Fajr — closes the Isha window. */
  nextFajr: Millis
}

export interface PrayerWindow {
  prayer: PrayerName
  /** Window opens at the adhan for this prayer. */
  start: Millis
  /** Window closes here, exclusive. */
  end: Millis
}

export interface PrayerStatus {
  prayer: PrayerName
  state: PrayerState
  start: Millis
  end: Millis
  /** When it was checked off, if it was. */
  doneAt: Millis | null
  /** ms until the window closes; negative once closed. */
  msLeft: number
  /**
   * The make-up window is still open: a missed prayer can still be recorded
   * late, and a late one undone. False while the window itself is open — that
   * is an ordinary check — and false once the make-up window has passed too.
   */
  canMakeUp: boolean
}

/**
 * The three theme modes.
 *
 * `solar` is not a third palette. It is the same two palettes with the ground
 * blended between them by how much daylight there actually is at the user's
 * coordinates — full night before dawn, full day between sunrise and sunset,
 * and a graded hour either side.
 */
export const THEMES = ['dark', 'light', 'solar'] as const
export type Theme = (typeof THEMES)[number]

export const THEME_LABELS: Record<Theme, string> = {
  dark: 'Dark',
  light: 'Light',
  solar: 'Follow the sun'
}

export const CALC_METHODS = ['MuslimWorldLeague', 'UmmAlQura', 'Egyptian', 'Karachi'] as const
export type CalcMethod = (typeof CALC_METHODS)[number]

export const CALC_METHOD_LABELS: Record<CalcMethod, string> = {
  MuslimWorldLeague: 'Muslim World League',
  UmmAlQura: 'Umm al-Qura',
  Egyptian: 'Egyptian General Authority',
  Karachi: 'University of Islamic Sciences, Karachi'
}

export const MADHABS = ['shafi', 'hanafi'] as const
export type Madhab = (typeof MADHABS)[number]

export interface Settings {
  latitude: number
  longitude: number
  timezone: string
  calcMethod: CalcMethod
  madhab: Madhab
  /** Minutes added to Fajr to place the logical day boundary. Usually 0. */
  dayStartOffsetMin: number
  /**
   * The first day this app was responsible for. Days before it are shown as
   * untracked rather than judged — you cannot miss a prayer the app was not
   * yet watching. Set once, on first run.
   */
  trackingStartDate: DateStr | null
  theme: Theme
  notifyOnWindowOpen: boolean
  /** Minutes-before-close reminders, e.g. [30, 10]. */
  notifyLeadMinutes: number[]
  targetBedtime: string // "HH:MM"
  targetWakeTime: string // "HH:MM"
  /** Tolerance in minutes for calling a night "on target". */
  sleepTargetToleranceMin: number
  quitDate: string | null // "YYYY-MM-DD"
  cigarettesPerDay: number
  pricePerPack: number
  cigarettesPerPack: number
  currency: string
  launchOnStartup: boolean
  minimizeToTray: boolean
  longSessionWarnHours: number
}

export interface Habit {
  id: number
  /** Stable across devices; the identity this row syncs under. */
  uid: string
  name: string
  position: number
  /** Bitmask of weekdays this applies to; bit 0 = Sunday .. bit 6 = Saturday. */
  daysMask: number
  archived: boolean
  createdAt: Millis
}

export interface HabitLog {
  habitId: number
  date: DateStr
  done: boolean
  /** A grace day keeps a streak alive but is always visibly marked as one. */
  grace: boolean
}

export interface AvoidItem {
  id: number
  /** Stable across devices; the identity this row syncs under. */
  uid: string
  name: string
  position: number
  archived: boolean
  /** The pinned quit-tracker card on the home screen follows this item. */
  isQuitTracker: boolean
  createdAt: Millis
}

export type AvoidStatus = 'clean' | 'slip'

export interface AvoidLog {
  itemId: number
  date: DateStr
  status: AvoidStatus
  note: string | null
  updatedAt: Millis
}

export interface WorkSession {
  id: number
  /** Stable across devices; the identity this row syncs under. */
  uid: string
  date: DateStr
  project: string
  startedAt: Millis
  endedAt: Millis | null
  note: string | null
  /** Seconds; live-computed for a running session. */
  durationSec: number
}

export interface SleepSession {
  id: number
  /** Logical day this night belongs to — a 01:00 bedtime belongs to the previous day. */
  date: DateStr
  sleepAt: Millis | null
  wakeAt: Millis | null
  note: string | null
}

export interface StreakInfo {
  current: number
  record: number
  /** Whether a grace day is still available this calendar month. */
  graceAvailable?: boolean
  /**
   * Prayer streak only: true when every day in the current run was fully on
   * time. False as soon as even one day in it was only kept by a catch-up —
   * the run still counts, but it reads as kept rather than clean.
   */
  pure?: boolean
}

export interface ScoreBreakdown {
  prayers: number
  habits: number
  avoid: number
  sleep: number
  work: number
  total: number
}

export interface DaySnapshot {
  date: DateStr
  isToday: boolean
  /** False for days that have not started yet. */
  isPast: boolean
  /** False for days that predate the first run — those are never scored. */
  tracked: boolean
  prayers: PrayerStatus[]
  /** The 5/5 prayer streak as it stood at the end of this day. */
  prayerStreak: StreakInfo
  habits: Array<{
    habit: Habit
    applies: boolean
    done: boolean
    grace: boolean
    streak: StreakInfo
    /** 30 days ending on this day, oldest first. The row strip shows the last 7. */
    history: Array<{
      date: DateStr
      applies: boolean
      done: boolean
      grace: boolean
      /** False before the app existed — untracked, never a miss. */
      tracked: boolean
    }>
    /** Completions within the calendar month this day belongs to. */
    monthDone: number
    monthApplicable: number
  }>
  avoid: Array<{
    item: AvoidItem
    status: AvoidStatus | null
    note: string | null
    streak: StreakInfo
  }>
  work: WorkSession[]
  workSecToday: number
  sleep: SleepSession | null
  sleepOnTarget: boolean
  score: ScoreBreakdown
  note: string | null
}

export interface WeeklyReview {
  weekStart: DateStr
  note: string
  fixNext: string
  createdAt: Millis
  updatedAt: Millis
}

export interface WeekStats {
  weekStart: DateStr
  weekEnd: DateStr
  avgScore: number
  /** On-time prayers over possible. Make-ups are excluded on purpose. */
  prayerRate: number
  prayersDone: number
  prayersLate: number
  prayersPossible: number
  focusedHours: number
  avgSleepHours: number
  bestDay: { date: DateStr; score: number } | null
  worstDay: { date: DateStr; score: number } | null
  longestStreaks: Array<{ name: string; current: number; record: number }>
  days: Array<{ date: DateStr; score: number }>
}

export interface CalendarDay {
  date: DateStr
  inFuture: boolean
  /** Days before the app existed are shown blank, not as failures. */
  tracked: boolean
  prayerStates: PrayerState[]
  score: number
  hasSlip: boolean
  hasGrace: boolean
  /** All five prayers done in time — earns the mihrab mark. Make-ups do not. */
  allPrayers: boolean
  /** The pinned quit item had no slip — earns the smoke-free mark. */
  quitClean: boolean
  /** Prayed inside the window. */
  prayersDone: number
  /** Prayed after the window closed. Never folded into `prayersDone`. */
  prayersLate: number
  workSeconds: number
  note: string | null
}

export interface QuitStats {
  itemId: number | null
  quitDate: string | null
  days: number
  cigarettesAvoided: number
  moneySaved: number
  currency: string
  streak: StreakInfo
}
