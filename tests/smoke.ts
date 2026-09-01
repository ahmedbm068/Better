/**
 * End-to-end smoke test of the storage and service layers.
 *
 * Runs inside Electron (better-sqlite3 is built against Electron's ABI) against
 * a throwaway database. Exercises the real SQL, the real prayer maths, and the
 * real guards — the parts unit tests cannot reach.
 *
 * Build and run:  npm run smoke
 */
import { app } from 'electron'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openDatabase, closeDatabase } from '../src/main/db/index'
import { readSettings, writeSettings } from '../src/main/db/settings'
import * as day from '../src/main/services/dayService'
import * as prayerTimes from '../src/main/services/prayerTimes'
import * as work from '../src/main/services/workService'
import * as sleep from '../src/main/services/sleepService'
import * as calendar from '../src/main/services/calendarService'
import * as stats from '../src/main/services/statsService'
import * as review from '../src/main/services/reviewService'
import * as backup from '../src/main/services/backupService'
import { quitStats } from '../src/main/services/quitService'
import * as habitsRepo from '../src/main/db/repo/habits'
import * as avoidRepo from '../src/main/db/repo/avoid'
import * as prayersRepo from '../src/main/db/repo/prayers'
import { buildWindows } from '../src/shared/prayer'
import { formatClock } from '../src/shared/format'
import { addDays } from '../src/shared/time'

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

function expectThrows(name: string, fn: () => unknown, expectGuard = true): void {
  try {
    fn()
    check(name, false, 'expected a refusal, got success')
  } catch (err) {
    const isGuard = err instanceof Error && err.name === 'GuardError'
    check(name, expectGuard ? isGuard : true, err instanceof Error ? err.message : String(err))
  }
}

function run(): void {
  const dir = mkdtempSync(join(tmpdir(), 'better-smoke-'))
  const dbFile = join(dir, 'test.sqlite')
  console.log(`database: ${dbFile}`)

  try {
    section('schema and seed')
    openDatabase(dbFile)
    const habits = habitsRepo.listHabits()
    const avoid = avoidRepo.listAvoidItems()
    check('seeds six habits', habits.length === 6, habits.map((h) => h.name).join(' | '))
    check('seeds four avoid items', avoid.length === 4)
    check(
      'pins the nicotine item as the quit tracker',
      avoidRepo.getQuitTrackerItem()?.name.includes('cigarettes') === true
    )

    section('settings')
    const settings = writeSettings({
      latitude: 36.8065,
      longitude: 10.1815,
      timezone: 'Africa/Tunis',
      calcMethod: 'MuslimWorldLeague',
      quitDate: '2026-01-01',
      cigarettesPerDay: 20,
      pricePerPack: 9.5,
      cigarettesPerPack: 20,
      currency: 'TND'
    })
    check('stores and reads settings back', readSettings().timezone === 'Africa/Tunis')
    check('clamps a nonsense latitude', writeSettings({ latitude: 999 }).latitude === 90)
    writeSettings({ latitude: 36.8065 })

    section('prayer times')
    const today = day.currentDate()
    const times = prayerTimes.getDayTimes(today, settings)
    const tz = settings.timezone
    console.log(
      `  ${today}  fajr ${formatClock(times.fajr, tz)} · sunrise ${formatClock(times.sunrise, tz)} · ` +
        `dhuhr ${formatClock(times.dhuhr, tz)} · asr ${formatClock(times.asr, tz)} · ` +
        `maghrib ${formatClock(times.maghrib, tz)} · isha ${formatClock(times.isha, tz)}`
    )
    check(
      'produces times in ascending order',
      times.fajr < times.sunrise &&
        times.sunrise < times.dhuhr &&
        times.dhuhr < times.asr &&
        times.asr < times.maghrib &&
        times.maghrib < times.isha
    )
    check("closes Fajr's window at sunrise", buildWindows(times)[0].end === times.sunrise)
    check("closes Isha's window at the next Fajr", buildWindows(times)[4].end === times.nextFajr)
    check(
      'snapshots the times so a settings change cannot rewrite them',
      prayerTimes.getDayTimes(today, settings).fajr === times.fajr
    )

    section('prayer guards')
    const windows = buildWindows(times)
    const fajr = windows[0]
    // Aim squarely at a moment inside the Fajr window and one after it closed.
    const insideFajr = fajr.start + Math.floor((fajr.end - fajr.start) / 2)
    const afterFajr = fajr.end + 60_000

    expectThrows('refuses a check before the window opens', () =>
      day.checkPrayer(today, 'fajr', fajr.start - 60_000)
    )
    expectThrows('refuses a retroactive check after the window closed', () =>
      day.checkPrayer(today, 'fajr', afterFajr)
    )

    day.checkPrayer(today, 'fajr', insideFajr)
    const afterCheck = day.getPrayerStatuses(today, afterFajr, settings)
    check('records a check made inside the window', afterCheck[0].state === 'done')
    check('keeps it done after the window closes', afterCheck[0].doneAt === insideFajr)

    expectThrows('refuses to undo a check once the window closed', () =>
      day.uncheckPrayer(today, 'fajr', afterFajr)
    )
    check(
      'leaves an unchecked closed window as missed',
      day.getPrayerStatuses(today, times.nextFajr + 1, settings)[1].state === 'missed'
    )

    section('days before tracking started')
    // The Fajr check above is already on the books, so adopting a tracking start
    // must not disown it — this is the upgrade path for a database that predates
    // the setting.
    const trackingStart = day.ensureTrackingStart()
    check('records the first tracked day', trackingStart === today, trackingStart)
    check(
      'never disowns history that already exists',
      day.isTracked(prayersRepo.allMarks()[0].date),
      `earliest mark ${prayersRepo.allMarks()[0].date}`
    )
    const before = addDays(today, -10)
    check('treats an earlier day as untracked', !day.isTracked(before))
    check('does not score an untracked day', day.scoreFor(before).total === 0)
    check('flags it on the snapshot', day.buildDaySnapshot(before).tracked === false)
    check(
      'still scores today',
      day.isTracked(today) && day.buildDaySnapshot(today).tracked === true
    )

    section('day rollover')
    const beforeFajr = times.fajr - 60_000
    check(
      'places a pre-Fajr instant in the previous logical day',
      day.currentDate(beforeFajr, settings) === addDays(today, -1),
      `${day.currentDate(beforeFajr, settings)} vs ${today}`
    )
    check(
      'rolls over exactly at Fajr',
      day.currentDate(times.fajr, settings) === today
    )

    section('habits')
    const gym = habits[0]
    day.setHabitDone(today, gym.id, true)
    let snapshot = day.buildDaySnapshot(today)
    const gymEntry = snapshot.habits.find((h) => h.habit.id === gym.id)!
    check('marks a habit done', gymEntry.done)
    check('counts it in the streak', gymEntry.streak.current >= 1)
    check('returns a 30-day history strip', gymEntry.history.length === 30)
    check(
      'counts this month for the expandable row',
      gymEntry.monthDone >= 1 && gymEntry.monthApplicable >= gymEntry.monthDone
    )

    expectThrows('refuses to change a habit on a past day', () =>
      day.setHabitDone(addDays(today, -3), gym.id, true)
    )

    day.useGraceDay(addDays(today, -1), habits[1].id)
    expectThrows('allows only one grace day per month', () =>
      day.useGraceDay(addDays(today, -1), habits[1].id)
    )
    expectThrows('refuses a grace day for an older day', () =>
      day.useGraceDay(addDays(today, -5), habits[2].id)
    )

    section('avoid list')
    const nicotine = avoid[0]
    day.setAvoidStatus(today, nicotine.id, 'clean', null)
    check(
      'marks an item clean',
      day.buildDaySnapshot(today).avoid.find((a) => a.item.id === nicotine.id)?.status === 'clean'
    )
    day.setAvoidStatus(today, avoid[1].id, 'slip', 'opened the app out of habit')
    const slipped = day.buildDaySnapshot(today).avoid.find((a) => a.item.id === avoid[1].id)!
    check('logs a slip with its note', slipped.status === 'slip' && slipped.note !== null)
    check('breaks that item’s streak', slipped.streak.current === 0)

    section('work sessions')
    const started = work.startSession('I am HIM')
    check('starts a session', started.endedAt === null)
    expectThrows('refuses a second concurrent session', () => work.startSession('Other'))
    const stopped = work.stopSession('wrote the storage layer')
    check('stops it and records a duration', stopped.endedAt !== null && stopped.durationSec >= 0)
    check('offers the project for autocomplete', work.listProjects().includes('I am HIM'))
    check('buckets weekly totals', work.totalsByBucket('week', 4).length === 4)

    // Back-date the start so the session has a real length: a session opened and
    // closed inside the same second is worth zero, by design.
    const lengthened = work.updateSession(stopped.id, { startedAt: stopped.endedAt! - 25 * 60_000 })
    check('accepts a corrected start time', lengthened?.durationSec === 25 * 60)
    check('totals today', work.secondsToday() >= 25 * 60, `${work.secondsToday()}s`)

    section('sleep')
    // A bedtime eight hours ago may belong to yesterday's logical day — which is
    // the whole point of the rollover, so the night is looked up by the date the
    // service filed it under rather than by whatever day it is now.
    const bedtime = Date.now() - 8 * 3_600_000
    const night0 = sleep.goingToSleep(bedtime)
    check(
      'files the night under the logical day it started in',
      night0.date === day.currentDate(bedtime),
      `${night0.date} (now ${day.currentDate()})`
    )
    sleep.wokeUp()
    const night = sleep.getForDate(night0.date)
    check(
      'records both ends of a night',
      night?.sleepAt != null && night?.wakeAt != null,
      night ? `${formatClock(night.sleepAt, tz)} → ${formatClock(night.wakeAt, tz)}` : ''
    )
    check(
      'attaches waking up to the open night, not to today',
      sleep.getOpen() === null
    )
    const nights = sleep.recentNights(30)
    check('returns a gap-filled 30-night series', nights.length === 30)
    check('summarises the series', sleep.summarize(nights).nightsRecorded >= 1)

    section('scoring')
    snapshot = day.buildDaySnapshot(today)
    const score = snapshot.score
    console.log(
      `  score ${score.total} = prayers ${score.prayers} + habits ${score.habits} + ` +
        `avoid ${score.avoid} + sleep ${score.sleep} + work ${score.work}`
    )
    check('keeps the score within range', score.total >= 0 && score.total <= 100)
    check(
      'sums the components',
      score.prayers + score.habits + score.avoid + score.sleep + score.work === score.total
    )
    check('awards work points for a session with real duration', score.work === 5)

    section('calendar and stats')
    const [y, m] = today.split('-').map(Number)
    const month = calendar.monthView(y, m)
    check('builds a full month grid', month.days.length % 7 === 0 && month.days.length >= 28)
    check(
      'leaves pre-tracking days blank rather than all-missed',
      month.days.filter((d) => !d.tracked).every((d) => d.score === 0)
    )
    check('marks future days as future', month.days.some((d) => d.inFuture) || today.endsWith('-31'))
    check('flags the slip on the calendar', month.days.find((d) => d.date === today)?.hasSlip === true)

    const weekView = calendar.weekView(today)
    check('builds a seven-day week view', weekView.days.length === 7)

    const overview = stats.statsOverview(30)
    check(
      'clamps the series to the tracking start',
      overview.series.length === 1 && overview.series[0].date === today,
      `${overview.series.length} day(s)`
    )
    check('buckets prayer rate by week', overview.prayerRate.length >= 1)
    check('returns a heatmap', overview.heatmap.length >= 1)
    check('reports the 5/5 streak', typeof overview.fiveOfFive.record === 'number')

    section('weekly review')
    const weekStats = review.weekStats(today)
    check(
      'aggregates only the tracked part of the week',
      weekStats.days.length === 1 && weekStats.prayersPossible === 5
    )
    review.saveReview(today, 'first week using it', 'sleep earlier')
    check('saves and reads a review back', review.getReview(today)?.fixNext === 'sleep earlier')
    check('lists saved reviews', review.listReviews().length === 1)

    section('quit counter')
    const quit = quitStats()
    check('counts days since the quit date', quit.days > 0, `${quit.days} days`)
    check(
      'derives cigarettes and money from the entered figures',
      quit.cigarettesAvoided === quit.days * 20 &&
        Math.abs(quit.moneySaved - quit.days * 9.5) < 0.01,
      `${quit.cigarettesAvoided} cigarettes · ${quit.moneySaved} ${quit.currency}`
    )

    section('export and import')
    const exportPath = join(dir, 'backup.json')
    const exported = backup.exportJson(exportPath)
    const totalRows = Object.values(exported.counts).reduce((a, b) => a + b, 0)
    check('exports every table', totalRows > 0, `${totalRows} rows`)

    // Destroy some data, then prove the restore brings it back.
    habitsRepo.deleteHabit(gym.id)
    avoidRepo.deleteAvoidItem(nicotine.id)
    check('data really was removed', habitsRepo.listHabits().length === 5)

    const restored = backup.importJson(exportPath)
    check(
      'restores the habits',
      habitsRepo.listHabits().length === 6,
      `${Object.values(restored.counts).reduce((a, b) => a + b, 0)} rows`
    )
    check('restores the avoid items', avoidRepo.listAvoidItems().length === 4)
    check(
      'restores the prayer mark',
      day.getPrayerStatuses(today, afterFajr, readSettings())[0].state === 'done'
    )
    check('restores the review', review.getReview(today)?.note === 'first week using it')
    check('wrote a safety copy before importing', restored.backupPath.length > 0)

    expectThrows(
      'rejects a file it did not write',
      () => {
        backup.validateBundle({ app: 'something else' })
      },
      false
    )

    section('csv export')
    const csvDir = join(dir, 'csv')
    const csv = backup.exportCsv(csvDir)
    check('writes one CSV per table plus settings', csv.files.length === 11, `${csv.files.length} files`)
  } finally {
    closeDatabase()
    rmSync(dir, { recursive: true, force: true })
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exitCode = failed === 0 ? 0 : 1
}

app.whenReady().then(() => {
  try {
    run()
  } catch (err) {
    console.error('\nsmoke test threw:', err)
    process.exitCode = 1
  }
  app.quit()
})
