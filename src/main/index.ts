/**
 * Main process.
 *
 * Owns the window, the tray, the global hotkey and the background tick. The app
 * is designed to keep running after the window is closed, because the prayer
 * reminders are the point — closing hides to the tray, quitting is explicit.
 */
import { app, BrowserWindow, globalShortcut, Menu, nativeImage, shell, Tray } from 'electron'
import { join } from 'node:path'
import { openDatabase, closeDatabase, getDbPath, migrateLegacyDatabase } from './db/index'
import { readSettings } from './db/settings'
import { registerIpc } from './ipc'
import { startScheduler, stopScheduler, tooltipText } from './services/scheduler'
import * as sync from './services/syncService'
import { currentDate, ensureTrackingStart } from './services/dayService'

app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.disableHardwareAcceleration()

const isDev = !app.isPackaged

/**
 * Folders earlier names of this app used, newest first. Checked once, only when
 * the current location is empty.
 */
function legacyDatabasePaths(): string[] {
  const roots = [app.getPath('appData')]
  return roots.flatMap((root) => [
    join(root, "I'm HIM", 'imhim.sqlite'),
    join(root, 'im-him', 'imhim.sqlite')
  ])
}
const HOTKEY = 'CommandOrControl+Shift+H'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let stopSync: (() => void) | null = null

/** How often a signed-in device checks in. A tracker does not need to be chatty. */
const SYNC_INTERVAL_MS = 15 * 60 * 1000

/** Resolves a bundled resource in both dev and a packaged (asar) build. */
function resourcePath(...parts: string[]): string {
  return isDev
    ? join(app.getAppPath(), 'resources', ...parts)
    : join(process.resourcesPath, 'app.asar.unpacked', 'resources', ...parts)
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 940,
    minHeight: 640,
    show: false,
    backgroundColor: '#0B0D10',
    autoHideMenuBar: true,
    title: 'Better',
    icon: resourcePath('icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.once('ready-to-show', () => window.show())

  // Closing hides to the tray so notifications keep working; only an explicit
  // quit (tray menu, or the OS shutting down) actually tears the app down.
  window.on('close', (event) => {
    if (!quitting && readSettings().minimizeToTray) {
      event.preventDefault()
      window.hide()
    }
  })

  window.on('closed', () => {
    mainWindow = null
  })

  // Anything trying to open a new window goes to the real browser instead.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

function showWindow(): void {
  if (!mainWindow) {
    mainWindow = createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function toggleWindow(): void {
  if (mainWindow?.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide()
  } else {
    showWindow()
  }
}

function navigate(route: string): void {
  showWindow()
  mainWindow?.webContents.send('navigate', route)
}

function createTray(): void {
  const icon = nativeImage.createFromPath(resourcePath('tray.png'))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('Better')

  const menu = Menu.buildFromTemplate([
    { label: 'Open', click: () => showWindow() },
    { type: 'separator' },
    { label: 'Today', click: () => navigate('home') },
    { label: 'Calendar', click: () => navigate('calendar') },
    { label: 'Stats', click: () => navigate('stats') },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        quitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => toggleWindow())
  refreshTray()
}

/** Keeps the tray tooltip showing the live countdown. */
function refreshTray(): void {
  if (!tray) return
  try {
    const now = Date.now()
    tray.setToolTip(tooltipText(currentDate(now), now))
  } catch {
    tray.setToolTip('Better')
  }
}

function applyLaunchOnStartup(enabled: boolean): void {
  if (isDev) return // Never register a dev build to launch at login.
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: ['--hidden']
  })
}

function broadcast(channel: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

// Only one copy may run: a second launch focuses the window that already exists.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  app.whenReady().then(() => {
    // Windows needs this for notifications to be attributed to the app.
    app.setAppUserModelId('com.better.app')

    // The filename is generic on purpose: a future rename moves the folder, and
    // never needs to touch the file inside it again.
    const dbFile = join(app.getPath('userData'), 'data.sqlite')
    const carried = migrateLegacyDatabase(dbFile, legacyDatabasePaths())
    if (carried) console.log(`carried existing data over from ${carried}`)
    openDatabase(dbFile)
    // Days before this one are shown as untracked rather than judged.
    ensureTrackingStart()

    const settings = readSettings()
    applyLaunchOnStartup(settings.launchOnStartup)

    registerIpc({
      getWindow: () => mainWindow,
      broadcast,
      applyLaunchOnStartup,
      refreshTray
    })

    createTray()

    // `--hidden` is passed by the login-item registration, so an auto-start
    // boots straight to the tray instead of stealing focus.
    const startHidden = process.argv.includes('--hidden')
    mainWindow = createWindow()
    if (startHidden) {
      mainWindow.once('ready-to-show', () => mainWindow?.hide())
    }

    if (!globalShortcut.register(HOTKEY, toggleWindow)) {
      console.warn(`Global hotkey ${HOTKEY} is already taken by another app.`)
    }

    startScheduler({
      onTooltip: (text) => tray?.setToolTip(text),
      onEvent: broadcast
    })

    // Sync runs on its own unhurried timer. It never gates the tray, the
    // notifications or the window: the local database has already answered
    // every question the app asks before a cycle starts.
    stopSync = sync.startScheduler(SYNC_INTERVAL_MS, () => {
      broadcast('data:changed')
      broadcast('sync:changed')
    })

    console.log(`Better — database at ${getDbPath()}`)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) showWindow()
  })

  // The window is not the app: with a tray icon present, closing it is a hide.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !tray) app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
  })

  app.on('will-quit', () => {
    stopScheduler()
    stopSync?.()
    globalShortcut.unregisterAll()
    closeDatabase()
  })
}

// A crash must not leave the database mid-write.
process.on('exit', () => closeDatabase())
