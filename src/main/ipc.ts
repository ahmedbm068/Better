/**
 * IPC handlers.
 *
 * Channel names match the method names in `@shared/api`, one to one. Every
 * handler is wrapped so a guard refusal ("that window has closed") arrives in
 * the renderer as a readable message instead of an unhandled rejection.
 */
import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { CalcMethod, DateStr, Millis, PrayerName, Settings } from '@shared/types'
import type { AppInfo, FileResult } from '@shared/api'
import { getDbPath } from './db/index'
import { readSettings, writeSettings } from './db/settings'
import * as day from './services/dayService'
import * as prayerTimes from './services/prayerTimes'
import * as work from './services/workService'
import * as sleep from './services/sleepService'
import * as calendar from './services/calendarService'
import * as stats from './services/statsService'
import * as review from './services/reviewService'
import * as backup from './services/backupService'
import { quitStats } from './services/quitService'
import * as sync from './services/syncService'
import { signIn } from './services/signIn'
import { clearAccount, getAccount, setAccount } from './db/account'
import { loginWithPassword, putPassword } from './services/syncClient'
import * as habitsRepo from './db/repo/habits'
import * as avoidRepo from './db/repo/avoid'
import * as miscRepo from './db/repo/misc'

type Handler = (...args: never[]) => unknown

export interface IpcDeps {
  getWindow: () => BrowserWindow | null
  broadcast: (channel: string, payload?: unknown) => void
  applyLaunchOnStartup: (enabled: boolean) => void
  refreshTray: () => void
}

let deps: IpcDeps

/** Registers one channel, normalising thrown errors into plain messages. */
function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await (fn as (...a: unknown[]) => unknown)(...args)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Preserve the distinction so the UI can style a rule refusal calmly.
      const name = err instanceof Error ? err.name : 'Error'
      throw new Error(`${name}: ${message}`)
    }
  })
}

/** Marks data as changed so every open view refetches. */
function changed(): void {
  deps.broadcast('data:changed')
  deps.refreshTray()
}

export function registerIpc(dependencies: IpcDeps): void {
  deps = dependencies

  // ---- app + settings -----------------------------------------------------
  handle('getInfo', (): AppInfo => {
    const settings = readSettings()
    return {
      version: app.getVersion(),
      electron: process.versions.electron,
      dbPath: getDbPath(),
      platform: process.platform,
      timezone: settings.timezone
    }
  })

  handle('getSettings', () => readSettings())

  handle('updateSettings', (patch: Partial<Settings>) => {
    const before = readSettings()
    const after = writeSettings(patch)
    // Location or method changed: recompute today onward, leave history alone.
    const geoChanged =
      before.latitude !== after.latitude ||
      before.longitude !== after.longitude ||
      before.calcMethod !== after.calcMethod ||
      before.madhab !== after.madhab ||
      before.timezone !== after.timezone
    if (geoChanged) prayerTimes.invalidateFrom(day.currentDate(Date.now(), after))
    if (before.launchOnStartup !== after.launchOnStartup) {
      deps.applyLaunchOnStartup(after.launchOnStartup)
    }
    changed()
    return after
  })

  handle(
    'previewPrayerTimes',
    (input: {
      latitude: number
      longitude: number
      calcMethod: CalcMethod
      madhab: 'shafi' | 'hanafi'
      timezone: string
    }) => {
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
    }
  )

  // ---- day ----------------------------------------------------------------
  handle('currentDate', () => day.currentDate())
  handle('getDay', (date: DateStr) => day.buildDaySnapshot(date))
  handle('setDayNote', (date: DateStr, note: string) => {
    miscRepo.setDayNote(date, note)
    changed()
  })

  // ---- prayers ------------------------------------------------------------
  handle('checkPrayer', (date: DateStr, prayer: PrayerName) => {
    const result = day.checkPrayer(date, prayer)
    changed()
    return result
  })
  handle('uncheckPrayer', (date: DateStr, prayer: PrayerName) => {
    const result = day.uncheckPrayer(date, prayer)
    changed()
    return result
  })

  // ---- habits -------------------------------------------------------------
  handle('listHabits', (includeArchived = false) => habitsRepo.listHabits(includeArchived))
  handle('createHabit', (name: string, daysMask: number) => {
    const habit = habitsRepo.createHabit(name, daysMask)
    changed()
    return habit
  })
  handle(
    'updateHabit',
    (id: number, patch: { name?: string; daysMask?: number; archived?: boolean }) => {
      const habit = habitsRepo.updateHabit(id, patch)
      changed()
      return habit
    }
  )
  handle('deleteHabit', (id: number) => {
    habitsRepo.deleteHabit(id)
    changed()
  })
  handle('reorderHabits', (ids: number[]) => {
    habitsRepo.reorderHabits(ids)
    changed()
  })
  handle('setHabitDone', (date: DateStr, habitId: number, done: boolean) => {
    day.setHabitDone(date, habitId, done)
    changed()
  })
  handle('useGraceDay', (date: DateStr, habitId: number) => {
    day.useGraceDay(date, habitId)
    changed()
  })
  handle('clearGraceDay', (date: DateStr, habitId: number) => {
    day.clearGraceDay(date, habitId)
    changed()
  })

  // ---- avoid list ---------------------------------------------------------
  handle('listAvoidItems', (includeArchived = false) => avoidRepo.listAvoidItems(includeArchived))
  handle('createAvoidItem', (name: string) => {
    const item = avoidRepo.createAvoidItem(name)
    changed()
    return item
  })
  handle(
    'updateAvoidItem',
    (id: number, patch: { name?: string; archived?: boolean; isQuitTracker?: boolean }) => {
      const item = avoidRepo.updateAvoidItem(id, patch)
      changed()
      return item
    }
  )
  handle('deleteAvoidItem', (id: number) => {
    avoidRepo.deleteAvoidItem(id)
    changed()
  })
  handle('reorderAvoidItems', (ids: number[]) => {
    avoidRepo.reorderAvoidItems(ids)
    changed()
  })
  handle(
    'setAvoidStatus',
    (date: DateStr, itemId: number, status: 'clean' | 'slip' | null, note: string | null) => {
      day.setAvoidStatus(date, itemId, status, note)
      changed()
    }
  )
  handle('getQuitStats', () => quitStats())

  // ---- work ---------------------------------------------------------------
  handle('startWork', (project: string) => {
    const session = work.startSession(project)
    changed()
    return session
  })
  handle('stopWork', (note: string | null) => {
    const session = work.stopSession(note)
    changed()
    return session
  })
  handle('getWorkTotals', () => ({
    todaySeconds: work.secondsToday(),
    weekSeconds: work.secondsThisWeek(),
    running: work.getRunning()
  }))
  handle('listProjects', () => work.listProjects())
  handle('listWorkForDate', (date: DateStr) => work.sessionsForDate(date))
  handle(
    'updateWorkSession',
    (
      id: number,
      patch: { project?: string; startedAt?: Millis; endedAt?: Millis | null; note?: string | null }
    ) => {
      const session = work.updateSession(id, patch)
      changed()
      return session
    }
  )
  handle('deleteWorkSession', (id: number) => {
    work.deleteSession(id)
    changed()
  })
  handle('getProjectTotals', (from: DateStr, to: DateStr) => work.projectTotals(from, to))
  handle('getWorkBuckets', (unit: 'week' | 'month', count: number) =>
    work.totalsByBucket(unit, count)
  )
  handle('resolveLongSession', (action: 'keep' | 'stop' | 'discard') => {
    if (action === 'stop') work.stopSession(null)
    if (action === 'discard') work.discardRunning(null)
    changed()
  })

  // ---- sleep --------------------------------------------------------------
  handle('goingToSleep', () => {
    const session = sleep.goingToSleep()
    changed()
    return session
  })
  handle('wokeUp', () => {
    const session = sleep.wokeUp()
    changed()
    return session
  })
  handle('getSleep', (date: DateStr) => sleep.getForDate(date))
  handle(
    'editSleep',
    (date: DateStr, patch: { sleepAt?: Millis | null; wakeAt?: Millis | null; note?: string | null }) => {
      const session = sleep.editSleep(date, patch)
      changed()
      return session
    }
  )
  handle('clearSleep', (date: DateStr) => {
    sleep.clearSleep(date)
    changed()
  })
  handle('getRecentNights', (days: number) => {
    const nights = sleep.recentNights(days)
    return { nights, summary: sleep.summarize(nights) }
  })

  // ---- calendar, stats, review --------------------------------------------
  handle('getMonth', (year: number, month: number) => calendar.monthView(year, month))
  handle('getWeek', (anchor: DateStr) => calendar.weekView(anchor))
  handle('getStats', (days: number) => stats.statsOverview(days))
  handle('getWeekStats', (anchor: DateStr) => review.weekStats(anchor))
  handle('getReview', (weekStart: DateStr) => review.getReview(weekStart))
  handle('saveReview', (weekStart: DateStr, note: string, fixNext: string) => {
    const saved = review.saveReview(weekStart, note, fixNext)
    changed()
    return saved
  })
  handle('listReviews', () => review.listReviews())
  handle('isReviewDue', () => review.isReviewDue())
  handle('getReviewAnchor', () => review.reviewAnchor())

  // ---- backup -------------------------------------------------------------
  handle('exportJson', async (): Promise<FileResult> => {
    const window = deps.getWindow()
    const result = await dialog.showSaveDialog(window!, {
      title: 'Export all data',
      defaultPath: join(app.getPath('documents'), backup.defaultExportName('json')),
      filters: [{ name: 'JSON backup', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false }
    const written = backup.exportJson(result.filePath)
    return { ok: true, path: written.path, counts: written.counts }
  })

  handle('exportCsv', async (): Promise<FileResult> => {
    const window = deps.getWindow()
    const result = await dialog.showOpenDialog(window!, {
      title: 'Choose a folder for the CSV files',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false }
    const dir = join(result.filePaths[0], backup.defaultExportName('csv'))
    const written = backup.exportCsv(dir)
    return { ok: true, path: written.path, message: `${written.files.length} files written` }
  })

  handle('importJson', async (): Promise<FileResult> => {
    const window = deps.getWindow()
    const result = await dialog.showOpenDialog(window!, {
      title: 'Restore from a JSON backup',
      properties: ['openFile'],
      filters: [{ name: 'JSON backup', extensions: ['json'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false }

    const confirm = await dialog.showMessageBox(window!, {
      type: 'warning',
      buttons: ['Replace all data', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Restore backup',
      message: 'This replaces everything currently stored.',
      detail: 'A copy of the current database is saved alongside it first.'
    })
    if (confirm.response !== 0) return { ok: false }

    const imported = backup.importJson(result.filePaths[0])
    changed()
    return {
      ok: true,
      path: result.filePaths[0],
      counts: imported.counts,
      backupPath: imported.backupPath
    }
  })

  // ---- window -------------------------------------------------------------
  handle('hideWindow', () => {
    deps.getWindow()?.hide()
  })
  handle('setLaunchOnStartup', (enabled: boolean) => {
    writeSettings({ launchOnStartup: enabled })
    deps.applyLaunchOnStartup(enabled)
    return enabled
  })

  // ---- sync ---------------------------------------------------------------
  handle('signIn', async (server: string, provider: 'github' | 'google' = 'github') => {
    await signIn(server, provider)
    // Straight into a first cycle, so the account is populated by the time the
    // user looks at it rather than at the next scheduled pass.
    await sync.syncNow(changed)
    deps.broadcast('sync:changed')
    return sync.status()
  })

  handle('signInWithPassword', async (server: string, email: string, password: string) => {
    const { token, user } = await loginWithPassword(server, email, password)
    setAccount({ server: server.replace(/\/+$/, ''), token, userId: user.id, email: user.email })
    await sync.syncNow(changed)
    deps.broadcast('sync:changed')
    return sync.status()
  })

  handle('setPassword', async (password: string) => {
    const account = getAccount()
    if (!account) throw new Error('Sign in first.')
    await putPassword(account, password)
  })

  handle('signOut', () => {
    clearAccount()
    deps.broadcast('sync:changed')
    return sync.status()
  })

  handle('syncNow', async () => {
    const report = await sync.syncNow(changed)
    deps.broadcast('sync:changed')
    return report
  })

  handle('syncStatus', () => sync.status())
}
