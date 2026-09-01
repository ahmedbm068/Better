/**
 * The desktop sync cycle.
 *
 * The transport is swapped for one that calls the real server code directly, so
 * a full round trip — device writes, pushes, another device pulls — runs
 * without a network but through the genuine merge on both sides. Only the HTTP
 * hop is missing, and that is the part `syncClient` keeps to itself.
 *
 * Build and run:  npm run syncservice-check
 */
import { app } from 'electron'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openDatabase, closeDatabase } from '../src/main/db/index'
import { setAccount, getAccount, clearAccount } from '../src/main/db/account'
import { hasPendingChanges, getCursor } from '../src/main/db/sync'
import { syncNow, status, useTransport } from '../src/main/services/syncService'
import { SessionExpired } from '../src/main/services/syncClient'
import type { SyncTransport } from '../src/main/services/syncClient'
import * as habitsRepo from '../src/main/db/repo/habits'
import * as miscRepo from '../src/main/db/repo/misc'

import type { Sql, SqlValue, Statement } from '../server/src/db'
import { SCHEMA } from '../server/src/schema'
import { pull, push } from '../server/src/changes'

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed++
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(name: string): void {
  console.log(`\n${name}`)
}

function sqlite(file: string): Sql & { close(): void } {
  const db = new Database(file)
  return {
    close: () => db.close(),
    async all<T>(sql: string, ...p: SqlValue[]): Promise<T[]> {
      return db.prepare(sql).all(...p) as T[]
    },
    async first<T>(sql: string, ...p: SqlValue[]): Promise<T | undefined> {
      return (db.prepare(sql).get(...p) as T | undefined) ?? undefined
    },
    async run(sql: string, ...p: SqlValue[]): Promise<number> {
      return db.prepare(sql).run(...p).changes
    },
    async batch(statements: Statement[]): Promise<void> {
      db.transaction(() => {
        for (const s of statements) db.prepare(s.sql).run(...s.params)
      })()
    },
    async migrate(statements: readonly string[]): Promise<void> {
      for (const sql of statements) db.exec(sql)
    }
  }
}

/** The server, reached in-process instead of over HTTP. */
function directTransport(sql: Sql, userId: string): SyncTransport {
  return {
    pull: (since) => pull(sql, userId, since),
    push: (rows) => push(sql, userId, rows)
  }
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'better-syncservice-'))
  const server = sqlite(join(dir, 'server.sqlite'))
  const deviceA = join(dir, 'a.sqlite')
  const deviceB = join(dir, 'b.sqlite')
  const userId = 'user-1'

  try {
    await server.migrate(SCHEMA)
    await server.run(
      'INSERT INTO users (id, provider, provider_id, created_at, seeded) VALUES (?, ?, ?, ?, 1)',
      userId,
      'test',
      'test',
      Date.now()
    )

    let habitUid = ''

    section('a device that is not signed in does nothing')
    openDatabase(deviceA)
    useTransport(() => null)
    const idle = await syncNow()
    check('no push, no pull', idle.pushed === 0 && idle.pulled === 0)
    check('and no error either', idle.error === null, 'offline is not a failure')
    check('status says signed out', status().signedIn === false)

    section('signing in and pushing')
    setAccount({ server: 'http://test.invalid', token: 't', userId })
    useTransport(() => directTransport(server, userId))
    check('the account is stored', getAccount()?.userId === userId)

    const habit = habitsRepo.createHabit('Sport / training')
    habitUid = habit.uid
    miscRepo.setDayNote('2026-08-01', 'a good day')

    const first = await syncNow()
    check('rows went up', first.pushed > 0, `${first.pushed} rows`)
    check('nothing was refused', first.rejected.length === 0)
    check('the device owes nothing now', !hasPendingChanges())
    check('the cursor advanced', getCursor() > 0)
    check('status records the success', status().lastError === null)
    closeDatabase()

    section('a second device pulls it')
    openDatabase(deviceB)
    setAccount({ server: 'http://test.invalid', token: 't', userId })
    // The seed this device wrote on first open is its own; push it first so the
    // two sides are comparable.
    await syncNow()
    const arrived = habitsRepo.listHabits().find((h) => h.uid === habitUid)
    check('the habit arrived', arrived !== undefined)
    check('the note arrived', miscRepo.getDayNote('2026-08-01') === 'a good day')

    section('an edit here reaches the first device')
    habitsRepo.updateHabit(arrived!.id, { name: 'Training' })
    check('the edit is queued', hasPendingChanges())
    await syncNow()
    check('and is now clean', !hasPendingChanges())
    closeDatabase()

    openDatabase(deviceA)
    await syncNow()
    check(
      'the first device sees the new name',
      habitsRepo.listHabits().find((h) => h.uid === habitUid)?.name === 'Training'
    )

    section('a cycle is not started twice at once')
    const [one, two] = await Promise.all([syncNow(), syncNow()])
    check('both callers get the same run', one === two, 'the second joins the first')

    section('being offline is recorded, not fatal')
    useTransport(() => ({
      pull: () => Promise.reject(new Error('getaddrinfo ENOTFOUND')),
      push: () => Promise.reject(new Error('getaddrinfo ENOTFOUND'))
    }))
    habitsRepo.createHabit('Read 20 minutes')
    const offline = await syncNow()
    check('the failure is reported', offline.error !== null, offline.error ?? '')
    check('the work is still queued', hasPendingChanges(), 'nothing was thrown away')
    check('status shows the error', status().lastError !== null)

    useTransport(() => directTransport(server, userId))
    const recovered = await syncNow()
    check('the next cycle succeeds', recovered.error === null)
    check('and clears the queue', !hasPendingChanges())
    check('and clears the error', status().lastError === null)

    section('an expired session signs the device out without losing anything')
    habitsRepo.createHabit('Job applications')
    useTransport(() => ({
      pull: () => Promise.reject(new SessionExpired()),
      push: () => Promise.reject(new SessionExpired())
    }))
    const expired = await syncNow()
    check('the user is told to sign in again', expired.error?.includes('Sign in') === true)
    check('the account was forgotten', getAccount() === null)
    check('the rows were not', hasPendingChanges(), 'they go up again after signing back in')
    check('the cursor was reset', getCursor() === 0, 'a new account starts from the beginning')

    section('signing back in sends the backlog')
    setAccount({ server: 'http://test.invalid', token: 't2', userId })
    useTransport(() => directTransport(server, userId))
    const back = await syncNow()
    check('the backlog went up', back.pushed > 0, `${back.pushed} rows`)
    check('nothing is left owing', !hasPendingChanges())

    clearAccount()
    check('signing out forgets the account', status().signedIn === false)
  } finally {
    try {
      closeDatabase()
    } catch {
      // Already closed.
    }
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  app.exit(failed === 0 ? 0 : 1)
}

app.whenReady().then(() =>
  main().catch((err) => {
    console.error(err)
    app.exit(1)
  })
)
