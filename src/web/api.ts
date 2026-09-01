/**
 * `ImHimApi`, implemented for the browser.
 *
 * The desktop answers these calls in the main process over IPC; here they are
 * answered in the tab, against a sql.js database hydrated from the server. Both
 * call the same services, so the prayer windows, the day rollover, the scoring
 * and the streak rules have exactly one implementation.
 *
 * What is duplicated is the wiring, not the rules — these bodies mirror the
 * handlers in `main/ipc.ts`. The cleaner end state is one transport-neutral
 * module that both register against; this is the shape that gets there without
 * rewriting a working IPC layer in the same change.
 */
import type {
  AppInfo,
  AppEvent,
  AuthProvider,
  FileResult,
  ImHimApi,
  SyncReport,
  SyncStatus
} from '@shared/api'
import type {
  AvoidStatus,
  CalcMethod,
  DateStr,
  Millis,
  PrayerName,
  Settings
} from '@shared/types'

import { readSettings, writeSettings } from '../main/db/settings'
import * as day from '../main/services/dayService'
import * as prayerTimes from '../main/services/prayerTimes'
import * as work from '../main/services/workService'
import * as sleep from '../main/services/sleepService'
import * as calendar from '../main/services/calendarService'
import * as stats from '../main/services/statsService'
import * as review from '../main/services/reviewService'
import { quitStats } from '../main/services/quitService'
import * as habitsRepo from '../main/db/repo/habits'
import * as avoidRepo from '../main/db/repo/avoid'
import * as miscRepo from '../main/db/repo/misc'
import {
  buildBundle,
  validateBundle,
  applyBundle,
  toCsv,
  TABLES,
  defaultExportName
} from '../main/services/bundle'
import type { TableName } from '../main/services/bundle'
import * as sync from '../main/services/syncService'
import { loginWithPassword, putPassword } from '../main/services/syncClient'
import { getAccount, clearAccount, setAccount } from '../main/db/account'

/** Fires the events the renderer subscribes to. Locally, since there is no IPC. */
export class Events {
  private listeners = new Map<AppEvent, Set<(payload: unknown) => void>>()

  on(event: AppEvent, handler: (payload: unknown) => void): () => void {
    const set = this.listeners.get(event) ?? new Set()
    set.add(handler)
    this.listeners.set(event, set)
    return () => set.delete(handler)
  }

  emit(event: AppEvent, payload?: unknown): void {
    for (const handler of this.listeners.get(event) ?? []) handler(payload)
  }
}

export interface WebApiDeps {
  events: Events
  /** Called after any write, so the snapshot can be saved. */
  onWrite: () => void
  /** Where the sync server lives. */
  server: string
  version: string
}

/** Hands the browser a file without ever putting it on a server. */
function download(filename: string, contents: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // Revoked on the next frame; revoking immediately can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Opens the file picker and resolves with what was chosen, or null. */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    // A cancelled picker fires nothing in most browsers, so the promise is
    // settled on the window regaining focus instead of hanging forever.
    addEventListener(
      'focus',
      () => setTimeout(() => resolve(input.files?.[0] ?? null), 500),
      { once: true }
    )
    input.click()
  })
}

export function createWebApi(deps: WebApiDeps): ImHimApi {
  const { events, onWrite } = deps

  /** Marks data as changed so every open view refetches. */
  const changed = (): void => {
    onWrite()
    events.emit('data:changed')
  }

  const syncChanged = (): void => {
    events.emit('sync:changed')
  }

  return {
    // ---- app + settings ---------------------------------------------------
    async getInfo(): Promise<AppInfo> {
      return {
        version: deps.version,
        electron: '',
        dbPath: 'This browser',
        platform: 'web',
        timezone: readSettings().timezone
      }
    },

    async getSettings() {
      return readSettings()
    },

    async updateSettings(patch: Partial<Settings>) {
      const before = readSettings()
      const after = writeSettings(patch)
      const geoChanged =
        before.latitude !== after.latitude ||
        before.longitude !== after.longitude ||
        before.calcMethod !== after.calcMethod ||
        before.madhab !== after.madhab ||
        before.timezone !== after.timezone
      if (geoChanged) prayerTimes.invalidateFrom(day.currentDate(Date.now(), after))
      changed()
      return after
    },

    async previewPrayerTimes(input: {
      latitude: number
      longitude: number
      calcMethod: CalcMethod
      madhab: 'shafi' | 'hanafi'
      timezone: string
    }) {
      const settings = { ...readSettings(), ...input }
      const row = prayerTimes.calcTimes(day.currentDate(), settings)
      return {
        fajr: row.fajr,
        sunrise: row.sunrise,
        dhuhr: row.dhuhr,
        asr: row.asr,
        maghrib: row.maghrib,
        isha: row.isha
      }
    },

    // ---- day --------------------------------------------------------------
    async currentDate() {
      return day.currentDate()
    },
    async getDay(date: DateStr) {
      return day.buildDaySnapshot(date)
    },
    async setDayNote(date: DateStr, note: string) {
      miscRepo.setDayNote(date, note)
      changed()
    },

    // ---- prayers ----------------------------------------------------------
    async checkPrayer(date: DateStr, prayer: PrayerName) {
      const result = day.checkPrayer(date, prayer)
      changed()
      return result
    },
    async uncheckPrayer(date: DateStr, prayer: PrayerName) {
      const result = day.uncheckPrayer(date, prayer)
      changed()
      return result
    },

    // ---- habits -----------------------------------------------------------
    async listHabits(includeArchived = false) {
      return habitsRepo.listHabits(includeArchived)
    },
    async createHabit(name: string, daysMask: number) {
      const habit = habitsRepo.createHabit(name, daysMask)
      changed()
      return habit
    },
    async updateHabit(id: number, patch: { name?: string; daysMask?: number; archived?: boolean }) {
      const habit = habitsRepo.updateHabit(id, patch)
      changed()
      return habit
    },
    async deleteHabit(id: number) {
      habitsRepo.deleteHabit(id)
      changed()
    },
    async reorderHabits(ids: number[]) {
      habitsRepo.reorderHabits(ids)
      changed()
    },
    async setHabitDone(date: DateStr, habitId: number, done: boolean) {
      day.setHabitDone(date, habitId, done)
      changed()
    },
    async useGraceDay(date: DateStr, habitId: number) {
      day.useGraceDay(date, habitId)
      changed()
    },
    async clearGraceDay(date: DateStr, habitId: number) {
      day.clearGraceDay(date, habitId)
      changed()
    },

    // ---- avoid list -------------------------------------------------------
    async listAvoidItems(includeArchived = false) {
      return avoidRepo.listAvoidItems(includeArchived)
    },
    async createAvoidItem(name: string) {
      const item = avoidRepo.createAvoidItem(name)
      changed()
      return item
    },
    async updateAvoidItem(
      id: number,
      patch: { name?: string; archived?: boolean; isQuitTracker?: boolean }
    ) {
      const item = avoidRepo.updateAvoidItem(id, patch)
      changed()
      return item
    },
    async deleteAvoidItem(id: number) {
      avoidRepo.deleteAvoidItem(id)
      changed()
    },
    async reorderAvoidItems(ids: number[]) {
      avoidRepo.reorderAvoidItems(ids)
      changed()
    },
    async setAvoidStatus(
      date: DateStr,
      itemId: number,
      status: AvoidStatus | null,
      note: string | null
    ) {
      day.setAvoidStatus(date, itemId, status, note)
      changed()
    },
    async getQuitStats() {
      return quitStats()
    },

    // ---- work -------------------------------------------------------------
    async startWork(project: string) {
      const session = work.startSession(project)
      changed()
      return session
    },
    async stopWork(note: string | null) {
      const session = work.stopSession(note)
      changed()
      return session
    },
    async getWorkTotals() {
      return {
        todaySeconds: work.secondsToday(),
        weekSeconds: work.secondsThisWeek(),
        running: work.getRunning()
      }
    },
    async listProjects() {
      return work.listProjects()
    },
    async listWorkForDate(date: DateStr) {
      return work.sessionsForDate(date)
    },
    async updateWorkSession(
      id: number,
      patch: { project?: string; startedAt?: Millis; endedAt?: Millis | null; note?: string | null }
    ) {
      const session = work.updateSession(id, patch)
      changed()
      return session
    },
    async deleteWorkSession(id: number) {
      work.deleteSession(id)
      changed()
    },
    async getProjectTotals(from: DateStr, to: DateStr) {
      return work.projectTotals(from, to)
    },
    async getWorkBuckets(unit: 'week' | 'month', count: number) {
      return work.totalsByBucket(unit, count)
    },
    async resolveLongSession(action: 'keep' | 'stop' | 'discard') {
      if (action === 'stop') work.stopSession(null)
      if (action === 'discard') work.discardRunning(null)
      changed()
    },

    // ---- sleep ------------------------------------------------------------
    async goingToSleep() {
      const session = sleep.goingToSleep()
      changed()
      return session
    },
    async wokeUp() {
      const session = sleep.wokeUp()
      changed()
      return session
    },
    async getSleep(date: DateStr) {
      return sleep.getForDate(date)
    },
    async editSleep(
      date: DateStr,
      patch: { sleepAt?: Millis | null; wakeAt?: Millis | null; note?: string | null }
    ) {
      const session = sleep.editSleep(date, patch)
      changed()
      return session
    },
    async clearSleep(date: DateStr) {
      sleep.clearSleep(date)
      changed()
    },
    async getRecentNights(days: number) {
      const nights = sleep.recentNights(days)
      return { nights, summary: sleep.summarize(nights) }
    },

    // ---- calendar, stats, review ------------------------------------------
    async getMonth(year: number, month: number) {
      return calendar.monthView(year, month)
    },
    async getWeek(anchor: DateStr) {
      return calendar.weekView(anchor)
    },
    async getStats(days: number) {
      return stats.statsOverview(days)
    },
    async getWeekStats(anchor: DateStr) {
      return review.weekStats(anchor)
    },
    async getReview(weekStart: DateStr) {
      return review.getReview(weekStart)
    },
    async saveReview(weekStart: DateStr, note: string, fixNext: string) {
      const saved = review.saveReview(weekStart, note, fixNext)
      changed()
      return saved
    },
    async listReviews() {
      return review.listReviews()
    },
    async isReviewDue() {
      return review.isReviewDue()
    },
    async getReviewAnchor() {
      return review.reviewAnchor()
    },

    // ---- backup -----------------------------------------------------------
    async exportJson(): Promise<FileResult> {
      const bundle = buildBundle()
      const name = defaultExportName('json')
      download(name, JSON.stringify(bundle, null, 2), 'application/json')
      return { ok: true, path: name, counts: bundle.counts }
    },

    async exportCsv(): Promise<FileResult> {
      // One file rather than a folder: a browser cannot be handed a directory,
      // so the tables are concatenated with a header line naming each.
      const bundle = buildBundle()
      const parts: string[] = []
      for (const table of TABLES as readonly TableName[]) {
        parts.push(`# ${table}`, toCsv(bundle.tables[table] ?? []), '')
      }
      const name = `${defaultExportName('csv')}.csv`
      download(name, parts.join('\r\n'), 'text/csv')
      return { ok: true, path: name }
    },

    async importJson(): Promise<FileResult> {
      const file = await pickFile('application/json,.json')
      if (!file) return { ok: false }

      let parsed: unknown
      try {
        parsed = JSON.parse(await file.text())
      } catch {
        throw new Error('ImportError: That file could not be read as JSON.')
      }

      const bundle = validateBundle(parsed)
      if (!confirm('This replaces everything currently stored in this browser. Continue?')) {
        return { ok: false }
      }

      const counts = applyBundle(bundle)
      changed()
      return { ok: true, path: file.name, counts }
    },

    // ---- window -----------------------------------------------------------
    async hideWindow() {
      // Nothing to hide: a tab is the user's to close.
    },
    async setLaunchOnStartup() {
      // A web page cannot start with the machine. The setting stays off, and
      // the UI reads this back rather than assuming it took.
      return false
    },

    // ---- sync -------------------------------------------------------------
    async signIn(server: string, provider: AuthProvider): Promise<SyncStatus> {
      // The browser is already where OAuth belongs, so no loopback dance: the
      // server redirects back here with the token in the fragment, and `boot`
      // stores it before the app mounts.
      location.href = `${server.replace(/\/+$/, '')}/auth/${provider}/start`
      return sync.status()
    },

    async signInWithPassword(
      server: string,
      email: string,
      password: string
    ): Promise<SyncStatus> {
      const base = server.replace(/\/+$/, '')
      const { token, user } = await loginWithPassword(base, email, password)
      setAccount({ server: base, token, userId: user.id, email: user.email })
      onWrite()
      await sync.syncNow(changed)
      syncChanged()
      return sync.status()
    },

    async setPassword(password: string): Promise<void> {
      const account = getAccount()
      if (!account) throw new Error('Sign in first.')
      await putPassword(account, password)
    },

    async signOut(): Promise<SyncStatus> {
      clearAccount()
      onWrite()
      syncChanged()
      return sync.status()
    },

    async syncNow(): Promise<SyncReport> {
      const report = await sync.syncNow(changed)
      onWrite()
      syncChanged()
      return report
    },

    async syncStatus(): Promise<SyncStatus> {
      return sync.status()
    },

    on: (event, handler) => events.on(event, handler)
  }
}

export { getAccount, setAccount }
