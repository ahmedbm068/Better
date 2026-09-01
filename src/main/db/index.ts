/**
 * The database. One SQLite file in Electron's userData folder, opened once for
 * the life of the process. Nothing here reaches the network.
 */
import Database from 'better-sqlite3'
import type { DatabaseType } from './types'
import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { MIGRATIONS, SEED_HABITS, SEED_AVOID } from './schema'
import { ALL_DAYS_MASK } from '@shared/streaks'
import { uuidv7 } from '@shared/uid'

import { getDb, setDb, hasDb } from './handle'

export { getDb }

let dbPath = ''

export function getDbPath(): string {
  return dbPath
}

export function openDatabase(file: string): DatabaseType {
  mkdirSync(dirname(file), { recursive: true })
  const handle = new Database(file) as unknown as DatabaseType
  handle.pragma('journal_mode = WAL')
  handle.pragma('foreign_keys = ON')
  handle.pragma('synchronous = NORMAL')
  migrate(handle)
  seed(handle)
  setDb(handle)
  dbPath = file
  return handle
}

export function closeDatabase(): void {
  if (!hasDb()) return
  const db = getDb()
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    // A checkpoint failure must never block shutdown.
  }
  db.close()
  setDb(null)
}

function migrate(handle: DatabaseType): void {
  const current = handle.pragma('user_version', { simple: true }) as number
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue
    handle.exec('BEGIN')
    try {
      handle.exec(m.up)
      m.after?.(handle)
      handle.pragma(`user_version = ${m.version}`)
      handle.exec('COMMIT')
    } catch (err) {
      handle.exec('ROLLBACK')
      throw err
    }
  }
}

/** First-run defaults. Only ever runs when the tables are still empty. */
function seed(handle: DatabaseType): void {
  const now = Date.now()
  const habitCount = handle.prepare('SELECT COUNT(*) AS n FROM habits').get() as { n: number }
  if (habitCount.n === 0) {
    const insert = handle.prepare(
      `INSERT INTO habits (uid, name, position, days_mask, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`
    )
    SEED_HABITS.forEach((name, i) => insert.run(uuidv7(now), name, i, ALL_DAYS_MASK, now, now))
  }

  const avoidCount = handle.prepare('SELECT COUNT(*) AS n FROM avoid_items').get() as { n: number }
  if (avoidCount.n === 0) {
    const insert = handle.prepare(
      `INSERT INTO avoid_items (uid, name, position, archived, is_quit_tracker, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?, ?)`
    )
    SEED_AVOID.forEach((item, i) =>
      insert.run(uuidv7(now), item.name, i, item.quitTracker ? 1 : 0, now, now)
    )
  }
}

/** Copies the database (and its WAL) to a timestamped file next to the original. */
export function backupDatabase(suffix = 'backup'): string {
  const handle = getDb()
  handle.pragma('wal_checkpoint(TRUNCATE)')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = join(dirname(dbPath), `better-${suffix}-${stamp}.sqlite`)
  copyFileSync(dbPath, target)
  return target
}

export function databaseExists(file: string): boolean {
  return existsSync(file)
}

/**
 * Carries a database across an app rename.
 *
 * Renaming the app moves its userData folder, which would otherwise orphan
 * every prayer, habit and streak already recorded. If the new location is empty
 * and an older one holds data, it is copied over with `VACUUM INTO` — that
 * folds any outstanding write-ahead log into one clean file, which a plain file
 * copy would not.
 *
 * The original is left untouched, so a failed migration is never a loss.
 */
export function migrateLegacyDatabase(target: string, legacyFiles: string[]): string | null {
  if (existsSync(target)) return null

  for (const legacy of legacyFiles) {
    if (!existsSync(legacy)) continue
    try {
      mkdirSync(dirname(target), { recursive: true })
      const source = new Database(legacy, { readonly: false }) as unknown as DatabaseType
      try {
        source.prepare('VACUUM INTO ?').run(target)
      } finally {
        source.close()
      }
      return legacy
    } catch {
      // A legacy file that will not open is skipped rather than fatal: the app
      // still starts, just empty, and the original is left where it was.
    }
  }
  return null
}

/** Runs `fn` inside a transaction, rolling back on any throw. */
export function transaction<T>(fn: () => T): T {
  return getDb().transaction(fn)()
}
