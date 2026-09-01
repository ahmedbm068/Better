/**
 * The v1 -> v2 upgrade, against a database that predates sync.
 *
 * Every existing install takes this path exactly once, and it is the one thing
 * the unit tests and the smoke test cannot reach: both start from an empty
 * file, where migration 2 has no rows to convert.
 *
 * Builds a v1 database by hand from the SQL of migration 1, fills it with the
 * shape of data a real user would have, then opens it through the normal path
 * and checks that nothing was lost and everything can sync.
 *
 * Build and run:  npm run migration-check
 */
import { app } from 'electron'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MIGRATIONS } from '../src/main/db/schema'

/** Whatever the newest migration is, so adding one does not break this check. */
const LATEST_SCHEMA = MIGRATIONS[MIGRATIONS.length - 1].version
import { openDatabase, closeDatabase, getDb } from '../src/main/db/index'
import * as habitsRepo from '../src/main/db/repo/habits'
import * as avoidRepo from '../src/main/db/repo/avoid'
import * as workRepo from '../src/main/db/repo/work'
import * as sleepRepo from '../src/main/db/repo/sleep'
import * as prayersRepo from '../src/main/db/repo/prayers'
import * as miscRepo from '../src/main/db/repo/misc'
import { isUuidV7, uuidV7Time } from '../src/shared/uid'

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

/** A database at exactly migration 1, as an install from before sync would be. */
function buildLegacyDatabase(file: string, createdAt: number): void {
  const db = new Database(file)
  db.exec(MIGRATIONS[0].up)
  db.pragma('user_version = 1')

  const habit = db.prepare(
    'INSERT INTO habits (id, name, position, days_mask, archived, created_at) VALUES (?, ?, ?, 127, 0, ?)'
  )
  habit.run(1, 'Sport / training', 0, createdAt)
  habit.run(2, 'Read 20 minutes', 1, createdAt + 1000)

  const log = db.prepare(
    'INSERT INTO habit_logs (habit_id, date, done, grace, updated_at) VALUES (?, ?, ?, ?, ?)'
  )
  log.run(1, '2026-08-01', 1, 0, createdAt)
  log.run(2, '2026-08-02', 0, 1, createdAt)

  db.prepare(
    'INSERT INTO avoid_items (id, name, position, archived, is_quit_tracker, created_at) VALUES (?, ?, ?, 0, 1, ?)'
  ).run(1, 'No cigarettes / nicotine', 0, createdAt)
  db.prepare(
    'INSERT INTO avoid_logs (item_id, date, status, note, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(1, '2026-08-03', 'slip', 'a bad day', createdAt)

  db.prepare(
    'INSERT INTO work_sessions (id, date, project, started_at, ended_at) VALUES (?, ?, ?, ?, ?)'
  ).run(1, '2026-08-01', 'Better', createdAt, createdAt + 3600000)

  db.prepare('INSERT INTO sleep_sessions (date, sleep_at, wake_at) VALUES (?, ?, ?)').run(
    '2026-08-01',
    createdAt,
    createdAt + 28800000
  )

  db.prepare('INSERT INTO prayer_marks (date, prayer, done_at) VALUES (?, ?, ?)').run(
    '2026-08-01',
    'fajr',
    createdAt
  )
  db.prepare('INSERT INTO day_notes (date, note) VALUES (?, ?)').run('2026-08-01', 'a good day')
  db.prepare(
    'INSERT INTO weekly_reviews (week_start, note, fix_next, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run('2026-07-27', 'steady', 'sleep earlier', createdAt, createdAt)

  db.close()
}

function countRows(sql: string): number {
  return (getDb().prepare(sql).get() as { n: number }).n
}

function main(): void {
  const dir = mkdtempSync(join(tmpdir(), 'better-migration-'))
  const file = join(dir, 'data.sqlite')
  const createdAt = Date.UTC(2026, 7, 1, 9, 0, 0)

  try {
    buildLegacyDatabase(file, createdAt)

    section('before the upgrade')
    const legacy = new Database(file)
    check('starts at schema version 1', legacy.pragma('user_version', { simple: true }) === 1)
    check(
      'has no uid column yet',
      !(legacy.prepare('PRAGMA table_info(habits)').all() as Array<{ name: string }>).some(
        (c) => c.name === 'uid'
      )
    )
    legacy.close()

    // The upgrade itself: the ordinary open path, exactly as the app does it.
    openDatabase(file)
    const db = getDb()

    section('the upgrade')
    check('lands on the current schema version', db.pragma('user_version', { simple: true }) === LATEST_SCHEMA)

    section('nothing was lost')
    check('both habits survive', habitsRepo.listHabits().length === 2)
    check('habit logs survive', habitsRepo.allHabitLogs().length === 2)
    check('the avoid item survives', avoidRepo.listAvoidItems().length === 1)
    check('the slip survives', avoidRepo.allAvoidLogs().length === 1)
    check('the work session survives', workRepo.allWorkSessions().length === 1)
    check('the night survives', sleepRepo.allSleepSessions().length === 1)
    check('the prayer mark survives', prayersRepo.allMarks().length === 1)
    check('the day note survives', miscRepo.allDayNotes().length === 1)
    check('the review survives', miscRepo.getReview('2026-07-27') !== null)
    check('the spent grace day is still spent', habitsRepo.graceUsedInMonth(2, '2026-08'))

    section('every row can now sync')
    const habits = habitsRepo.listHabits()
    const items = avoidRepo.listAvoidItems()
    const sessions = workRepo.allWorkSessions()
    const allUids = [...habits, ...items, ...sessions].map((r) => r.uid)
    check('every row was given a uid', allUids.every(isUuidV7), `${allUids.length} rows`)
    check('the uids are distinct', new Set(allUids).size === allUids.length)
    check(
      'the uid encodes when the row was really created',
      uuidV7Time(habits[0].uid) === createdAt,
      new Date(uuidV7Time(habits[0].uid)).toISOString()
    )
    check('uids sort in creation order', uuidV7Time(habits[0].uid) < uuidV7Time(habits[1].uid))

    const stale =
      countRows('SELECT COUNT(*) AS n FROM habits WHERE updated_at = 0') +
      countRows('SELECT COUNT(*) AS n FROM avoid_items WHERE updated_at = 0') +
      countRows('SELECT COUNT(*) AS n FROM work_sessions WHERE updated_at = 0') +
      countRows('SELECT COUNT(*) AS n FROM sleep_sessions WHERE updated_at = 0') +
      countRows('SELECT COUNT(*) AS n FROM day_notes WHERE updated_at = 0') +
      countRows('SELECT COUNT(*) AS n FROM prayer_marks WHERE updated_at = 0')
    check('no row is left at updated_at = 0', stale === 0, 'they would lose every merge')
    check(
      'the prayer mark kept its real timestamp',
      (db.prepare('SELECT updated_at AS t FROM prayer_marks').get() as { t: number }).t === createdAt
    )

    section('deletes became tombstones')
    habitsRepo.deleteHabit(1)
    check('the habit is gone from reads', habitsRepo.getHabit(1) === null)
    check('only one habit is listed', habitsRepo.listHabits().length === 1)
    check(
      'the row is still on disk, marked deleted',
      countRows('SELECT COUNT(*) AS n FROM habits WHERE id = 1 AND deleted_at IS NOT NULL') === 1,
      'so the other device learns of the delete'
    )
    check(
      'its logs were tombstoned too',
      habitsRepo.allHabitLogs().every((l) => l.habit_id !== 1),
      'the FK cascade cannot fire for a row that still exists'
    )

    section('a cleared day can be logged again')
    habitsRepo.setHabitLog(2, '2026-08-05', true)
    check('logged', habitsRepo.getHabitLogsFor(2, '2026-08-05', '2026-08-05').length === 1)
    habitsRepo.setHabitLog(2, '2026-08-05', false)
    check('cleared', habitsRepo.getHabitLogsFor(2, '2026-08-05', '2026-08-05').length === 0)
    habitsRepo.setHabitLog(2, '2026-08-05', true)
    check(
      're-ticking revives the tombstone',
      habitsRepo.getHabitLogsFor(2, '2026-08-05', '2026-08-05').length === 1,
      'without this the write would vanish'
    )

    section('a deleted night can be recorded again')
    sleepRepo.deleteSleep('2026-08-01')
    check('the night is gone', sleepRepo.getSleepByDate('2026-08-01') === null)
    sleepRepo.setSleepAt('2026-08-01', createdAt)
    check(
      'writing it again revives it',
      sleepRepo.getSleepByDate('2026-08-01')?.sleepAt === createdAt,
      'INSERT OR IGNORE would have left it dead'
    )

    section('an un-checked prayer stays un-checked')
    prayersRepo.clearMark('2026-08-01', 'fajr')
    check('the mark is gone from reads', prayersRepo.getMarks('2026-08-01').fajr === undefined)
    check(
      'but a tombstone remains',
      countRows('SELECT COUNT(*) AS n FROM prayer_marks WHERE deleted_at IS NOT NULL') === 1
    )

    section('reordering still persists')
    const before = habitsRepo.listHabits().map((h) => h.id)
    const extra = habitsRepo.createHabit('Job applications')
    habitsRepo.reorderHabits([extra.id, ...before])
    check(
      'the new order is stored',
      habitsRepo.listHabits().map((h) => h.id)[0] === extra.id
    )
    check(
      'reordering bumps updated_at, so the order syncs',
      countRows(
        `SELECT COUNT(*) AS n FROM habits WHERE deleted_at IS NULL AND updated_at > ${createdAt}`
      ) === habitsRepo.listHabits().length
    )

    section('re-opening is idempotent')
    closeDatabase()
    openDatabase(file)
    check('still at the current version', getDb().pragma('user_version', { simple: true }) === LATEST_SCHEMA)
    check('habits unchanged', habitsRepo.listHabits().length === 2)
  } finally {
    try {
      closeDatabase()
    } catch {
      // Already closed.
    }
    rmSync(dir, { recursive: true, force: true })
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  app.exit(failed === 0 ? 0 : 1)
}

app.whenReady().then(main)
