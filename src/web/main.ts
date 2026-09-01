/**
 * The web entry point.
 *
 * `window.api` has to exist before the renderer loads, because
 * `renderer/src/lib/api.ts` reads it at module scope. That is why the renderer
 * is imported dynamically here rather than at the top: the import is what
 * starts React, and it must not happen until the database is open and the
 * first pull is in.
 */
import { boot } from './boot'

/**
 * The Worker that serves this page is also its API, so the default is simply
 * where we were loaded from. VITE_SYNC_SERVER is only for a split deployment.
 *
 * `location.origin` rather than an empty string: the account record treats a
 * blank server as "not signed in".
 */
const SERVER = import.meta.env.VITE_SYNC_SERVER || location.origin
const VERSION = import.meta.env.VITE_APP_VERSION ?? '0.0.0'

const splash = document.getElementById('splash')
const setStatus = (text: string): void => {
  const line = document.getElementById('splash-status')
  if (line) line.textContent = text
}

async function start(): Promise<void> {
  try {
    setStatus('Opening your data...')
    const { api } = await boot(SERVER, VERSION)
    window.api = api

    setStatus('Almost there...')
    await import('../renderer/src/main')
    splash?.remove()
  } catch (err) {
    // A failure here means no app at all, so it is shown rather than logged.
    const message = err instanceof Error ? err.message : String(err)
    setStatus(`Better could not start: ${message}`)
    console.error(err)
  }
}

void start()
