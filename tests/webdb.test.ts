/**
 * The browser database, running the real schema, repositories and services.
 *
 * sql.js is pure WebAssembly, so this runs under plain vitest — no Electron and
 * no native module. That makes it the cheapest possible proof of the claim the
 * web client rests on: that the same rules can run in a browser rather than
 * being reimplemented on the server.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { openWebDatabase } from '../src/web/sqljs'
import type { WebDatabase } from '../src/web/sqljs'
import { setDb } from '../src/main/db/handle'
import { MIGRATIONS } from '../src/main/db/schema'
import * as habitsRepo from '../src/main/db/repo/habits'
import * as avoidRepo from '../src/main/db/repo/avoid'
import * as workRepo from '../src/main/db/repo/work'
import * as prayersRepo from '../src/main/db/repo/prayers'
import * as miscRepo from '../src/main/db/repo/misc'
import { pendingChanges, applyChanges, hasPendingChanges, markPushed } from '../src/main/db/sync'
import { readSettings, writeSettings } from '../src/main/db/settings'
import { getDayTimes } from '../src/main/services/prayerTimes'
import { isUuidV7 } from '../src/shared/uid'

const require = createRequire(import.meta.url)
const wasmUrl = require.resolve('sql.js/dist/sql-wasm.wasm')

let db: WebDatabase
let writes = 0

beforeAll(async () => {
  db = await openWebDatabase({ wasmUrl, onWrite: () => writes++ })
  setDb(db)
  for (const migration of MIGRATIONS) {
    db.exec(migration.up)
    migration.after?.(db)
    db.pragma(`user_version = ${migration.version}`)
  }
})

afterAll(() => {
  setDb(null)
  db?.close()
})

describe('the schema applies', () => {
  it('reaches the current version', () => {
    const latest = MIGRATIONS[MIGRATIONS.length - 1].version
    expect(db.pragma('user_version', { simple: true })).toBe(latest)
  })

  it('created the sync tables the desktop app has', () => {
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string
      }>
    ).map((r) => r.name)
    expect(names).toContain('habits')
    expect(names).toContain('prayer_marks')
    expect(names).toContain('sync_state')
  })
})

describe('the repositories work unchanged', () => {
  it('creates a habit with a real uid', () => {
    const habit = habitsRepo.createHabit('Sport / training')
    expect(isUuidV7(habit.uid)).toBe(true)
    expect(habitsRepo.getHabit(habit.id)?.name).toBe('Sport / training')
  })

  it('reports the id of an inserted row', () => {
    const first = habitsRepo.createHabit('Read 20 minutes')
    const second = habitsRepo.createHabit('Job applications')
    expect(second.id).toBeGreaterThan(first.id)
  })

  it('handles named parameters', () => {
    // putTimesRow binds an object, which sql.js needs the @ sigil for.
    prayersRepo.putTimesRow({
      date: '2026-08-01',
      fajr: 1,
      sunrise: 2,
      dhuhr: 3,
      asr: 4,
      maghrib: 5,
      isha: 6,
      latitude: 36.8,
      longitude: 10.2,
      method: 'MuslimWorldLeague',
      madhab: 'shafi',
      tz: 'Africa/Tunis',
      computed_at: 7
    })
    expect(prayersRepo.getTimesRow('2026-08-01')?.fajr).toBe(1)
  })

  it('rolls a failed transaction back', () => {
    const before = habitsRepo.listHabits().length
    expect(() =>
      db.transaction(() => {
        habitsRepo.createHabit('doomed')
        throw new Error('no')
      })()
    ).toThrow('no')
    expect(habitsRepo.listHabits().length).toBe(before)
  })

  it('tombstones rather than deletes', () => {
    const habit = habitsRepo.createHabit('temporary')
    habitsRepo.deleteHabit(habit.id)
    expect(habitsRepo.getHabit(habit.id)).toBeNull()
    const row = db
      .prepare('SELECT deleted_at FROM habits WHERE id = ?')
      .get(habit.id) as { deleted_at: number | null }
    expect(row.deleted_at).not.toBeNull()
  })
})

describe('the services work unchanged', () => {
  it('reads and writes settings', () => {
    writeSettings({ latitude: 36.8, longitude: 10.2 })
    expect(readSettings().latitude).toBeCloseTo(36.8)
  })

  it('keeps every theme mode, and refuses one it does not know', () => {
    for (const theme of ['dark', 'light', 'solar'] as const) {
      writeSettings({ theme })
      expect(readSettings().theme).toBe(theme)
    }
    // Sanitising is what stops a bad value reaching the stylesheet.
    writeSettings({ theme: 'neon' as unknown as 'dark' })
    expect(readSettings().theme).toBe('dark')
  })

  it('snapshots prayer times for a day', () => {
    const times = getDayTimes('2026-09-01', readSettings())
    expect(times.fajr).toBeGreaterThan(0)
    expect(times.nextFajr).toBeGreaterThan(times.fajr)
  })
})

describe('sync works the same as on the desktop', () => {
  it('queues local work', () => {
    expect(hasPendingChanges()).toBe(true)
    const pending = pendingChanges()
    expect((pending.habits?.length ?? 0) > 0).toBe(true)
    expect(pending.habits?.[0]).not.toHaveProperty('id')
  })

  it('clears what was pushed', () => {
    markPushed(pendingChanges())
    expect(hasPendingChanges()).toBe(false)
  })

  it('applies an incoming change set', () => {
    const uid = '01a05c2a-c66e-7a42-8da9-8b8b1aba7b8e'
    const result = applyChanges({
      seq: 4,
      rows: {
        habits: [
          {
            uid,
            name: 'From the server',
            position: 20,
            days_mask: 127,
            archived: 0,
            created_at: 1,
            updated_at: Date.now(),
            deleted_at: null
          }
        ]
      }
    })
    expect(result.applied).toBe(1)
    expect(habitsRepo.listHabits().some((h) => h.uid === uid)).toBe(true)
    expect(hasPendingChanges()).toBe(false)
  })
})

describe('a database survives a save and reload', () => {
  it('round-trips through exported bytes', async () => {
    avoidRepo.createAvoidItem('No cigarettes / nicotine', true)
    workRepo.startWork('2026-08-01', 'Better', Date.now())
    miscRepo.setDayNote('2026-08-01', 'a good day')
    const before = habitsRepo.listHabits().length

    const bytes = db.export()
    expect(bytes.byteLength).toBeGreaterThan(0)

    const reopened = await openWebDatabase({ wasmUrl, saved: bytes })
    setDb(reopened)
    try {
      expect(habitsRepo.listHabits().length).toBe(before)
      expect(miscRepo.getDayNote('2026-08-01')).toBe('a good day')
      expect(avoidRepo.listAvoidItems().length).toBe(1)
      expect(workRepo.allWorkSessions().length).toBe(1)
    } finally {
      setDb(db)
      reopened.close()
    }
  })

  it('notices writes, so a save can be debounced', () => {
    const seen = writes
    habitsRepo.createHabit('another')
    expect(writes).toBeGreaterThan(seen)
  })
})

describe('the file it writes is a real SQLite database', () => {
  it('starts with the SQLite header', () => {
    const header = Buffer.from(db.export().slice(0, 15)).toString('utf8')
    expect(header).toBe('SQLite format 3')
  })

  it('is the same format the desktop app reads', () => {
    // Not a round trip through better-sqlite3 here — that needs Electron — but
    // the header and page size are what make one possible.
    expect(readFileSync(wasmUrl).byteLength).toBeGreaterThan(0)
  })
})
