/**
 * The open database, and nothing else.
 *
 * Split out from `index.ts` so that everything above it — the repositories, the
 * services, the rules — can be bundled for a browser. `index.ts` opens a file
 * with better-sqlite3 and `node:fs`, neither of which exists on the web; this
 * module only remembers which handle is current.
 *
 * That is what lets the web client run the same day rollover, the same prayer
 * windows and the same scoring as the desktop app instead of a second
 * implementation of them living on the server.
 */
import type { DatabaseType } from './types'

let handle: DatabaseType | null = null

export function getDb(): DatabaseType {
  if (!handle) throw new Error('database not opened yet')
  return handle
}

/** Installs the handle. Whoever opened it owns closing it. */
export function setDb(db: DatabaseType | null): void {
  handle = db
}

export function hasDb(): boolean {
  return handle !== null
}
