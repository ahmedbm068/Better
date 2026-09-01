/**
 * Who this device is signed in as.
 *
 * Kept in `sync_state` rather than in `settings`, for two reasons: none of it
 * is a preference the user chose, and settings are written into every backup.
 * A session token in an export file would be a credential sitting in the user
 * downloads folder.
 */
import type { DatabaseType } from './types'
import { getDb } from './handle'

export interface Account {
  /** The base URL of the sync server, without a trailing slash. */
  server: string
  token: string
  userId: string
  /** The address the account is keyed on. Absent on accounts made before it. */
  email?: string | null
}

export interface SyncStatus {
  signedIn: boolean
  server: string | null
  userId: string | null
  email: string | null
  /** When the last complete cycle finished, or null if none has. */
  lastSyncAt: number | null
  /** Why the last attempt failed, or null if it succeeded. */
  lastError: string | null
  pending: boolean
}

function read(key: string, db: DatabaseType): string | null {
  const row = db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

function write(key: string, value: string | null, db: DatabaseType): void {
  if (value === null) {
    db.prepare('DELETE FROM sync_state WHERE key = ?').run(key)
    return
  }
  db.prepare('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)').run(key, value)
}

export function getAccount(db: DatabaseType = getDb()): Account | null {
  const server = read('server', db)
  const token = read('token', db)
  const userId = read('user_id', db)
  return server && token && userId
    ? { server, token, userId, email: read('email', db) }
    : null
}

export function setAccount(account: Account, db: DatabaseType = getDb()): void {
  write('server', account.server.replace(/\/+$/, ''), db)
  write('token', account.token, db)
  write('user_id', account.userId, db)
  write('email', account.email ?? null, db)
  write('last_error', null, db)
}

/**
 * Forgets the account without touching the data.
 *
 * The cursor goes too: signing back in — possibly as someone else — must start
 * from the beginning rather than resume a stranger sequence. Local rows are
 * left alone and stay dirty, so they are offered to whichever account signs in
 * next rather than being lost.
 */
export function clearAccount(db: DatabaseType = getDb()): void {
  for (const key of [
    'server',
    'token',
    'user_id',
    'email',
    'cursor',
    'last_error',
    'last_sync_at'
  ]) {
    write(key, null, db)
  }
}

export function recordSuccess(at: number, db: DatabaseType = getDb()): void {
  write('last_sync_at', String(at), db)
  write('last_error', null, db)
}

export function recordFailure(message: string, db: DatabaseType = getDb()): void {
  write('last_error', message, db)
}

export function readStatus(pending: boolean, db: DatabaseType = getDb()): SyncStatus {
  const account = getAccount(db)
  const at = read('last_sync_at', db)
  return {
    signedIn: account !== null,
    server: account?.server ?? null,
    userId: account?.userId ?? null,
    email: account?.email ?? null,
    lastSyncAt: at === null ? null : Number(at),
    lastError: read('last_error', db),
    pending
  }
}
