/**
 * Starting the web client.
 *
 * The order matters and is the whole of the file:
 *
 *  1. Open a database — the one saved in this browser, or an empty one.
 *  2. Apply migrations, exactly as the desktop app does on every launch.
 *  3. Take a token out of the URL if we have just come back from signing in.
 *  4. Pull everything the account has, so the first paint is real data.
 *  5. Install the API and hand back, for React to mount against.
 *
 * Step 4 is skipped when signed out. A signed-out browser is a usable app with
 * a local database — the same app, minus the syncing — which is what makes the
 * "try it before you sign up" path possible.
 */
import { openWebDatabase } from './sqljs'
import type { WebDatabase } from './sqljs'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { loadSnapshot, saveSnapshot, autoSave, clearSnapshot } from './persist'
import { createWebApi, Events } from './api'
import { setDb } from '../main/db/handle'
import { MIGRATIONS, SEED_HABITS, SEED_AVOID } from '../main/db/schema'
import { setAccount, getAccount } from '../main/db/account'
import { uuidv7 } from '@shared/uid'
import { ALL_DAYS_MASK } from '@shared/streaks'
import * as sync from '../main/services/syncService'
import type { ImHimApi } from '@shared/api'

export interface Booted {
  api: ImHimApi
  events: Events
  db: WebDatabase
  signedIn: boolean
}

/** Brings a fresh database up to the current schema. */
function migrate(db: WebDatabase): void {
  const current = Number(db.pragma('user_version', { simple: true }) ?? 0)
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue
    db.exec(migration.up)
    migration.after?.(db)
    db.pragma(`user_version = ${migration.version}`)
  }
}

/**
 * The starter lists, for a browser that is not signed in.
 *
 * A signed-in browser never reaches this: the account seeds server-side, once,
 * and this device pulls what is already there. Seeding here as well is what
 * would produce two sets of six habits.
 */
function seedLocalOnly(db: WebDatabase): void {
  const count = db.prepare('SELECT COUNT(*) AS n FROM habits').get() as { n: number }
  if (count.n > 0) return

  const now = Date.now()
  const habit = db.prepare(
    `INSERT INTO habits (uid, name, position, days_mask, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  )
  SEED_HABITS.forEach((name, i) => habit.run(uuidv7(now + i), name, i, ALL_DAYS_MASK, now, now))

  const avoid = db.prepare(
    `INSERT INTO avoid_items (uid, name, position, archived, is_quit_tracker, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, ?)`
  )
  SEED_AVOID.forEach((item, i) =>
    avoid.run(uuidv7(now + 100 + i), item.name, i, item.quitTracker ? 1 : 0, now, now)
  )
}

/**
 * Reads a token out of the URL fragment and stores it.
 *
 * The fragment, not the query string: a browser never sends it to a server, so
 * the token stays out of every access log between here and the origin. It is
 * stripped from the address bar immediately so a copied link carries no session.
 */
function claimToken(server: string): boolean {
  const fragment = new URLSearchParams(location.hash.slice(1))
  const token = fragment.get('token')
  if (!token) return false

  const userId = fragment.get('user') ?? 'me'
  setAccount({ server, token, userId })
  history.replaceState(null, '', location.pathname + location.search)
  return true
}

export async function boot(server: string, version: string): Promise<Booted> {
  const events = new Events()
  const saved = await loadSnapshot()

  let saver: { schedule: () => void } = { schedule: () => {} }
  const db = await openWebDatabase({
    wasmUrl,
    saved,
    onWrite: () => saver.schedule()
  })

  setDb(db)
  migrate(db)

  // Only after the schema exists, since it writes to sync_state.
  const arrived = claimToken(server)
  const account = getAccount()

  if (!account) seedLocalOnly(db)

  // Wired after migration so the first save is of a valid database.
  saver = autoSave(() => db.export())

  const api = createWebApi({ events, onWrite: () => saver.schedule(), server, version })

  if (account) {
    // A first pull before mounting, so the app opens on real data rather than
    // on an empty week that fills in a moment later.
    await sync.syncNow(() => events.emit('data:changed'))
    if (arrived) await saveSnapshot(db.export())
  }

  // A signed-in browser checks in on the same unhurried cadence as the desktop.
  sync.startScheduler(15 * 60 * 1000, () => {
    events.emit('data:changed')
    events.emit('sync:changed')
  })

  return { api, events, db, signedIn: account !== null }
}

/** Forgets everything this browser holds. Used when signing out for good. */
export async function wipeLocal(): Promise<void> {
  await clearSnapshot()
  location.reload()
}
