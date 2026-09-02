/**
 * The contract between the renderer and the main process.
 *
 * The renderer holds no database and no clock authority: it asks, main answers.
 * Every method here is exposed over `contextBridge` — there is no direct Node
 * access in the window.
 */
import type {
  AvoidItem,
  AvoidStatus,
  CalcMethod,
  DateStr,
  DaySnapshot,
  Habit,
  Millis,
  PrayerName,
  PrayerStatus,
  QuitStats,
  ScoreBreakdown,
  Settings,
  SleepSession,
  WeeklyReview,
  WeekStats,
  WorkSession
} from './types'

export interface AppInfo {
  version: string
  electron: string
  dbPath: string
  platform: string
  /** Resolved IANA zone actually in use. */
  timezone: string
}

export interface WorkTotals {
  todaySeconds: number
  weekSeconds: number
  running: WorkSession | null
}

export interface ProjectTotalsResult {
  from: DateStr
  to: DateStr
  totals: Array<{ project: string; seconds: number }>
  totalSeconds: number
}

export interface WorkBucket {
  bucket: string
  seconds: number
  byProject: Array<{ project: string; seconds: number }>
}

export interface SleepNight {
  date: DateStr
  sleepAt: Millis | null
  wakeAt: Millis | null
  durationMin: number | null
  bedtimePlot: number | null
  wakePlot: number | null
  onTarget: boolean
  note: string | null
}

export interface SleepSummary {
  avgDurationMin: number | null
  avgBedtimePlot: number | null
  nightsOnTarget: number
  nightsRecorded: number
}

export interface CalendarDay {
  date: DateStr
  inFuture: boolean
  tracked: boolean
  prayerStates: string[]
  score: number
  hasSlip: boolean
  hasGrace: boolean
  allPrayers: boolean
  quitClean: boolean
  prayersDone: number
  prayersLate: number
  workSeconds: number
  note: string | null
}

export interface CalendarMonth {
  year: number
  month: number
  from: DateStr
  to: DateStr
  today: DateStr
  days: CalendarDay[]
  trackingStart: DateStr | null
}

export interface CalendarWeek {
  weekStart: DateStr
  weekEnd: DateStr
  today: DateStr
  days: Array<
    CalendarDay & {
      habitsDone: number
      habitsApplicable: number
      sleepMinutes: number | null
      breakdown: ScoreBreakdown
      prayers: Array<{ prayer: string; state: string; start: Millis }>
      habitRows: Array<{ id: number; name: string; done: boolean; grace: boolean; applies: boolean }>
    }
  >
  previous: {
    avgScore: number | null
    prayersDone: number
    workSeconds: number
    sleepMin: number | null
  }
}

export interface StatsResult {
  from: DateStr
  to: DateStr
  series: Array<{
    date: DateStr
    score: number
    prayersDone: number
    prayersLate: number
    habitsDone: number
    habitsApplicable: number
    habitRatio: number | null
    workSeconds: number
  }>
  prayerRate: Array<{ bucket: DateStr; done: number; possible: number; rate: number }>
  heatmap: Array<{ date: DateStr; value: number | null; inFuture: boolean }>
  habits: Array<{
    id: number
    name: string
    streak: { current: number; record: number; graceAvailable?: boolean }
    completions: number
    applicableDays: number
    rate: number
  }>
  avoid: Array<{
    id: number
    name: string
    streak: { current: number; record: number }
    cleanDays: number
    slipDays: number
    isQuitTracker: boolean
  }>
  /** `pure` is false whenever the current run needed a catch-up, undefined at zero. */
  fiveOfFive: { current: number; record: number; pure?: boolean }
  totals: {
    daysTracked: number
    avgScore: number
    prayersDone: number
    prayersLate: number
    prayersPossible: number
    focusedHours: number
  }
}

export interface FileResult {
  ok: boolean
  /** Absent when the user cancelled the dialog. */
  path?: string
  message?: string
  counts?: Record<string, number>
  backupPath?: string
}

/** Events pushed from main. */
/** The providers an account can be created or reclaimed with. */
export type AuthProvider = 'github' | 'google'

export interface SyncStatus {
  signedIn: boolean
  server: string | null
  userId: string | null
  /** The address the account is keyed on, once known. */
  email: string | null
  lastSyncAt: Millis | null
  lastError: string | null
  /** Whether this device is holding changes the server has not seen. */
  pending: boolean
}

export interface SyncReport {
  pushed: number
  pulled: number
  rejected: Array<{ table: string; key: string; reason: string }>
  error: string | null
}

/**
 * Where the app is in the update cycle.
 *
 * `current` is a positive answer — checked, and there is nothing newer — while
 * `idle` means nothing has been checked yet, or this build does not update at
 * all. The UI needs to tell those apart to avoid claiming you are up to date
 * when nobody has looked.
 */
export type UpdateState = 'idle' | 'checking' | 'current' | 'available' | 'ready' | 'error'

export interface UpdateStatus {
  state: UpdateState
  /** The newer version, once one is known. */
  version: string | null
  /** 0..100 while downloading. */
  percent: number
  /** Why the last check failed, if it did. */
  message: string | null
  /** False in the browser and in development, where there is nothing to update. */
  supported: boolean
}

export type AppEvent =
  | 'tick'
  | 'day:rollover'
  | 'work:long-session'
  | 'review:due'
  | 'navigate'
  | 'data:changed'
  | 'sync:changed'
  | 'update:changed'

export interface ImHimApi {
  getInfo(): Promise<AppInfo>
  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  previewPrayerTimes(input: {
    latitude: number
    longitude: number
    calcMethod: CalcMethod
    madhab: 'shafi' | 'hanafi'
    timezone: string
  }): Promise<Record<string, Millis>>

  currentDate(): Promise<DateStr>
  getDay(date: DateStr): Promise<DaySnapshot>
  setDayNote(date: DateStr, note: string): Promise<void>

  checkPrayer(date: DateStr, prayer: PrayerName): Promise<PrayerStatus[]>
  uncheckPrayer(date: DateStr, prayer: PrayerName): Promise<PrayerStatus[]>

  listHabits(includeArchived?: boolean): Promise<Habit[]>
  createHabit(name: string, daysMask: number): Promise<Habit>
  updateHabit(
    id: number,
    patch: { name?: string; daysMask?: number; archived?: boolean }
  ): Promise<Habit | null>
  deleteHabit(id: number): Promise<void>
  reorderHabits(ids: number[]): Promise<void>
  setHabitDone(date: DateStr, habitId: number, done: boolean): Promise<void>
  useGraceDay(date: DateStr, habitId: number): Promise<void>
  clearGraceDay(date: DateStr, habitId: number): Promise<void>

  listAvoidItems(includeArchived?: boolean): Promise<AvoidItem[]>
  createAvoidItem(name: string): Promise<AvoidItem>
  updateAvoidItem(
    id: number,
    patch: { name?: string; archived?: boolean; isQuitTracker?: boolean }
  ): Promise<AvoidItem | null>
  deleteAvoidItem(id: number): Promise<void>
  reorderAvoidItems(ids: number[]): Promise<void>
  setAvoidStatus(
    date: DateStr,
    itemId: number,
    status: AvoidStatus | null,
    note: string | null
  ): Promise<void>
  getQuitStats(): Promise<QuitStats>

  startWork(project: string): Promise<WorkSession>
  stopWork(note: string | null): Promise<WorkSession>
  getWorkTotals(): Promise<WorkTotals>
  listProjects(): Promise<string[]>
  listWorkForDate(date: DateStr): Promise<WorkSession[]>
  updateWorkSession(
    id: number,
    patch: { project?: string; startedAt?: Millis; endedAt?: Millis | null; note?: string | null }
  ): Promise<WorkSession | null>
  deleteWorkSession(id: number): Promise<void>
  getProjectTotals(from: DateStr, to: DateStr): Promise<ProjectTotalsResult>
  getWorkBuckets(unit: 'week' | 'month', count: number): Promise<WorkBucket[]>
  resolveLongSession(action: 'keep' | 'stop' | 'discard'): Promise<void>

  goingToSleep(): Promise<SleepSession>
  wokeUp(): Promise<SleepSession>
  getSleep(date: DateStr): Promise<SleepSession | null>
  editSleep(
    date: DateStr,
    patch: { sleepAt?: Millis | null; wakeAt?: Millis | null; note?: string | null }
  ): Promise<SleepSession>
  clearSleep(date: DateStr): Promise<void>
  getRecentNights(days: number): Promise<{ nights: SleepNight[]; summary: SleepSummary }>

  getMonth(year: number, month: number): Promise<CalendarMonth>
  getWeek(anchor: DateStr): Promise<CalendarWeek>

  getStats(days: number): Promise<StatsResult>

  getWeekStats(anchor: DateStr): Promise<WeekStats>
  getReview(weekStart: DateStr): Promise<WeeklyReview | null>
  saveReview(weekStart: DateStr, note: string, fixNext: string): Promise<WeeklyReview>
  listReviews(): Promise<WeeklyReview[]>
  isReviewDue(): Promise<boolean>
  getReviewAnchor(): Promise<DateStr>

  exportJson(): Promise<FileResult>
  exportCsv(): Promise<FileResult>
  importJson(): Promise<FileResult>

  hideWindow(): Promise<void>
  setLaunchOnStartup(enabled: boolean): Promise<boolean>

  /** Opens the browser to sign in, and resolves once the token comes back. */
  signIn(server: string, provider: AuthProvider): Promise<SyncStatus>
  /** Signs in directly, for someone who has set a password. */
  signInWithPassword(server: string, email: string, password: string): Promise<SyncStatus>
  /** Sets or replaces the password on the signed-in account. */
  setPassword(password: string): Promise<void>
  signOut(): Promise<SyncStatus>
  syncNow(): Promise<SyncReport>
  syncStatus(): Promise<SyncStatus>

  /** What the updater knows right now, without asking the network. */
  updateStatus(): Promise<UpdateStatus>
  /** Asks GitHub whether a newer version exists. Downloads it if so. */
  checkForUpdate(): Promise<UpdateStatus>
  /** Quits and installs an update that has finished downloading. */
  installUpdate(): Promise<void>

  /** Subscribes to a main-process event. Returns an unsubscribe function. */
  on(event: AppEvent, handler: (payload: unknown) => void): () => void
}
