/**
 * Auto-update, over GitHub Releases.
 *
 * The feed is `latest.yml`, which electron-builder writes next to the installer
 * and which every release has to carry. That file is the whole mechanism: the
 * app reads a version and a checksum out of it and never looks at the `.exe`
 * directly. A release published without it updates nobody and reports nothing —
 * the check simply finds no newer version, which is indistinguishable from
 * being up to date. It is the one failure mode worth remembering here.
 *
 * Downloading happens on its own; installing does not. Better lives in the tray
 * and is rarely quit, so waiting for a quit could mean waiting weeks. Settings
 * offers a restart the moment an update is ready, and `autoInstallOnAppQuit`
 * catches everyone who never presses it.
 */
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/api'

/** Long enough after launch to stay out of the way of opening the window. */
const FIRST_CHECK_DELAY_MS = 8_000

/** And every six hours, for a machine that is left running for weeks. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

let status: UpdateStatus = {
  state: 'idle',
  version: null,
  percent: 0,
  message: null,
  supported: false
}

let notify: () => void = () => {}

function set(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch }
  notify()
}

export function currentStatus(): UpdateStatus {
  return status
}

/**
 * True only in a packaged build.
 *
 * A development run has no `app-update.yml` inside it, so the first check
 * throws. Guarding here keeps that out of the console and lets the UI say
 * plainly that this particular build does not update itself.
 */
function supported(): boolean {
  return app.isPackaged
}

/** Wires the updater up and starts checking. Returns a stop function. */
export function startUpdater(broadcast: () => void): () => void {
  notify = broadcast

  if (!supported()) {
    set({ supported: false, state: 'idle', message: 'This build does not update itself.' })
    return () => {}
  }

  set({ supported: true })

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => set({ state: 'checking', message: null }))
  autoUpdater.on('update-not-available', () =>
    set({ state: 'current', version: null, percent: 0, message: null })
  )
  autoUpdater.on('update-available', (info) =>
    set({ state: 'available', version: info.version, percent: 0, message: null })
  )
  autoUpdater.on('download-progress', (progress) =>
    set({ state: 'available', percent: Math.round(progress.percent) })
  )
  autoUpdater.on('update-downloaded', (info) =>
    set({ state: 'ready', version: info.version, percent: 100, message: null })
  )
  // Being offline is the ordinary case here, not a fault worth interrupting
  // anyone over. It is recorded, shown in Settings, and otherwise ignored.
  autoUpdater.on('error', (err) =>
    set({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  )

  const tick = (): void => {
    // The listener above records the reason; this only stops an unhandled
    // rejection from taking the main process down with it.
    void autoUpdater.checkForUpdates().catch(() => {})
  }

  const first = setTimeout(tick, FIRST_CHECK_DELAY_MS)
  const repeat = setInterval(tick, CHECK_INTERVAL_MS)

  return () => {
    clearTimeout(first)
    clearInterval(repeat)
  }
}

/** A check the user asked for. Resolves with whatever is known afterwards. */
export async function checkNow(): Promise<UpdateStatus> {
  if (!supported()) return status
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    set({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  }
  return status
}

/**
 * Quits and installs.
 *
 * Refuses unless the download has finished, because calling it earlier restarts
 * the app for nothing. `before-quit` sets the app's own quitting flag, so the
 * close-to-tray handler stands aside and the quit actually goes through.
 */
export function installNow(): void {
  if (status.state !== 'ready') return
  // Show the installer's progress, and bring the app back up afterwards.
  autoUpdater.quitAndInstall(false, true)
}
