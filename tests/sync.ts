/**
 * The local sync engine: what a device owes, and what it does with what it gets.
 *
 * Two real databases stand in for two devices. They are opened one at a time,
 * because that is how sync actually happens — a device pushes what it has, and
 * some time later the other one pulls it — and because the repositories work
 * against one open database at a time.
 *
 * Build and run:  npm run sync-check
 */
import { app } from 'electron'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openDatabase, closeDatabase, getDb } from '../src/main/db/index'
import { readSettings } from '../src/main/db/settings'
import { getDayTimes } from '../src/main/services/prayerTimes'
import {
  pendingChanges,
  markPushed,
  applyChanges,
  hasPendingChanges,
  getCursor,
  reconcileGraceDays
} from '../src/main/db/sync'
import { countRows } from '../src/shared/sync'
import type { SyncRows } from '../src/shared/sync'
import * as habitsRepo from '../src/main/db/repo/habits'
import * as workRepo from '../src/main/db/repo/work'
import * as prayersRepo from '../src/main/db/repo/prayers'
import * as miscRepo from '../src/main/db/repo/misc'

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

/** Opens one device, does something with it, and closes it again. */
function withDevice<T>(file: string, fn: () => T): T {
  openDatabase(file)
  try {
    return fn()
  } finally {
    closeDatabase()
  }
}

/** Strips the first-run seed, so a merge can be observed on its own. */
function clearSeed(): void {
  const db = getDb()
  db.prepare('DELETE FROM habits').run()
  db.prepare('DELETE FROM avoid_items').run()
}

function main(): void {
  const dir = mkdtempSync(join(tmpdir(), 'better-sync-'))
  const deviceA = join(dir, 'a.sqlite')
  const deviceB = join(dir, 'b.sqlite')
  const t0 = Date.UTC(2026, 7, 1, 9, 0, 0)

  try {
    let fromA: SyncRows = {}
    let habitUid = ''

    section('a fresh device owes everything it has')
    withDevice(deviceA, () => {
      clearSeed()
      const habit = habitsRepo.createHabit('Sport / training')
      habitUid = habit.uid
      habitsRepo.setHabitLog(habit.id, '2026-08-01', true)
      workRepo.startWork('2026-08-01', 'Better', t0)
      miscRepo.setDayNote('2026-08-01', 'a good day')
      prayersRepo.setMark('2026-08-01', 'fajr', t0)
      // Touching the day is what snapshots its prayer times, exactly as the app does.
      getDayTimes('2026-08-01', readSettings())

      check('there is something to push', hasPendingChanges())
      fromA = pendingChanges()
      check('the habit is queued', fromA.habits?.length === 1)
      check('its log is queued', fromA.habit_logs?.length === 1)
      check(
        'the log travels by parent uid, not by local id',
        fromA.habit_logs?.[0].habit_uid === habitUid && !('habit_id' in fromA.habit_logs![0])
      )
      check('the work session is queued', fromA.work_sessions?.length === 1)
      check('the note is queued', fromA.day_notes?.length === 1)
      check('the prayer mark is queued', fromA.prayer_marks?.length === 1)
      check(
        'the prayer times snapshot is queued',
        (fromA.prayer_times?.length ?? 0) > 0,
        'written when the day was first touched'
      )

      section('a push clears what was accepted')
      const cleared = markPushed(fromA)
      check('every pushed row was cleared', cleared === countRows(fromA), `${cleared} rows`)
      check('nothing is left owing', !hasPendingChanges())

      section('an edit after a push owes again')
      habitsRepo.updateHabit(habit.id, { name: 'Sport' })
      check('the trigger marked it dirty', hasPendingChanges(), 'no write path had to remember')
      check('only the edited row is queued', pendingChanges().habits?.length === 1)
      markPushed(pendingChanges())
    })

    section('the other device takes the change set')
    withDevice(deviceB, () => {
      clearSeed()
      const result = applyChanges({ seq: 7, rows: fromA })
      check('every row applied', result.applied === countRows(fromA), `${result.applied} rows`)
      check('none were skipped', result.skipped === 0)
      check('none were deferred', result.deferred === 0)
      check('the cursor advanced', getCursor() === 7)

      const habits = habitsRepo.listHabits()
      check('the habit arrived', habits.length === 1 && habits[0].uid === habitUid)
      check(
        'it kept its identity, not device A local id',
        habits[0].uid === habitUid,
        habits[0].uid
      )
      check(
        'its log was reattached to the local row',
        habitsRepo.getHabitLogsFor(habits[0].id, '2026-08-01', '2026-08-01').length === 1
      )
      check('the note arrived', miscRepo.getDayNote('2026-08-01') === 'a good day')
      check('the prayer mark arrived', prayersRepo.getMarks('2026-08-01').fajr === t0)
      check(
        'pulled rows do not owe a push back',
        !hasPendingChanges(),
        'the triggers were muted while applying'
      )

      section('applying the same set twice changes nothing')
      const again = applyChanges({ seq: 8, rows: fromA })
      check('all skipped the second time', again.applied === 0 && again.skipped > 0)
      check('still one habit', habitsRepo.listHabits().length === 1)
      check('still nothing owed', !hasPendingChanges())
    })

    section('the newer edit wins, whichever device made it')
    withDevice(deviceB, () => {
      const habit = habitsRepo.listHabits()[0]
      habitsRepo.updateHabit(habit.id, { name: 'Training' })
      // Only the habit: reopening the device reseeded the lists cleared earlier,
      // and those rows are queued too.
      const fromB: SyncRows = { habits: pendingChanges().habits }

      // An older edit must lose, even though it arrives later.
      const stale = JSON.parse(JSON.stringify(fromB)) as SyncRows
      stale.habits![0].name = 'Stale'
      stale.habits![0].updated_at = 1
      const result = applyChanges({ rows: stale })
      check(
        'the stale edit was refused',
        result.skipped === 1 && result.applied === 0,
        `applied=${result.applied} skipped=${result.skipped}`
      )
      check('the newer name stands', habitsRepo.listHabits()[0].name === 'Training')

      const newer = JSON.parse(JSON.stringify(fromB)) as SyncRows
      newer.habits![0].name = 'Newer'
      // Newer than the local row, but not dated into the future: a row stamped
      // ahead of the real clock would beat every genuine edit that followed.
      newer.habits![0].updated_at = Number(fromB.habits![0].updated_at) + 1
      applyChanges({ rows: newer })
      check('a newer edit is taken', habitsRepo.listHabits()[0].name === 'Newer')
    })

    section('a prayer times snapshot is never overwritten')
    withDevice(deviceB, () => {
      const before = prayersRepo.getTimesRow('2026-08-01')!
      const rewritten = JSON.parse(JSON.stringify(fromA)) as SyncRows
      const row = rewritten.prayer_times!.find((r) => r.date === '2026-08-01')!
      row.fajr = Number(row.fajr) + 3_600_000
      const result = applyChanges({ rows: rewritten })
      check('the incoming snapshot was refused', result.skipped > 0)
      check(
        'the day keeps the times it was judged against',
        prayersRepo.getTimesRow('2026-08-01')!.fajr === before.fajr,
        'first write wins'
      )
    })

    section('a log whose habit has not arrived is held, not lost')
    withDevice(deviceB, () => {
      const orphan: SyncRows = {
        habit_logs: [
          {
            habit_uid: '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000',
            date: '2026-08-09',
            done: 1,
            grace: 0,
            updated_at: t0,
            deleted_at: null
          }
        ]
      }
      const result = applyChanges({ rows: orphan })
      check('it was deferred', result.deferred === 1 && result.applied === 0)
      check('nothing was invented for it', habitsRepo.listHabits().length === 1)
    })

    section('a delete travels')
    withDevice(deviceA, () => {
      const habit = habitsRepo.listHabits()[0]
      habitsRepo.deleteHabit(habit.id)
      fromA = pendingChanges()
      check('the tombstone is queued', fromA.habits?.[0].deleted_at !== null)
      check('so are its logs', (fromA.habit_logs?.length ?? 0) > 0)
    })
    withDevice(deviceB, () => {
      applyChanges({ rows: fromA })
      check('the habit is gone on the other device too', habitsRepo.listHabits().length === 0)
    })

    section('one grace day a month survives a merge')
    withDevice(deviceA, () => {
      const habit = habitsRepo.createHabit('Read 20 minutes')
      // What two offline devices produce: the same month, two different days.
      habitsRepo.setHabitLog(habit.id, '2026-09-03', false, true)
      habitsRepo.setHabitLog(habit.id, '2026-09-17', false, true)
      check('both were written', habitsRepo.getHabitLogs('2026-09-01', '2026-09-30').length === 2)

      const fixed = reconcileGraceDays()
      check('the later one was revoked', fixed === 1)
      const graced = habitsRepo
        .getHabitLogs('2026-09-01', '2026-09-30')
        .filter((l) => l.grace === 1)
      check('exactly one grace day stands', graced.length === 1)
      check('and it is the earliest', graced[0].date === '2026-09-03')
      check('the month is spent', habitsRepo.graceUsedInMonth(habit.id, '2026-09'))
    })
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

app.whenReady().then(() => {
  try {
    main()
  } catch (err) {
    // Without this a thrown error leaves Electron running with no window and
    // the run hangs instead of failing.
    console.error(err)
    app.exit(1)
  }
})
