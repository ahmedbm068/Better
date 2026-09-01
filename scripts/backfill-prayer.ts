/**
 * One-off maintenance: record a prayer that was performed while the app was not
 * watching. Deliberately bypasses the window guard by writing the mark directly,
 * because `checkPrayer` refuses closed windows by design and should keep doing so.
 */
import { app } from 'electron'
import { join } from 'node:path'
import { openDatabase, closeDatabase } from '../src/main/db/index'
import { readSettings } from '../src/main/db/settings'
import { currentDate, getPrayerStatuses } from '../src/main/services/dayService'
import { getDayTimes } from '../src/main/services/prayerTimes'
import { setMark, getMarks } from '../src/main/db/repo/prayers'
import { formatClock } from '../src/shared/format'
import { PRAYER_LABELS, type PrayerName } from '../src/shared/types'
import { zonedTimeToMs } from '../src/shared/time'

const PRAYER = (process.env.PRAYER ?? 'fajr') as PrayerName
const AT = process.env.AT ?? '04:30'
const APPLY = process.env.APPLY === '1'

app.whenReady().then(() => {
  const dbFile = join(process.env.APPDATA!, 'Better', 'data.sqlite')
  console.log('database:', dbFile)
  openDatabase(dbFile)

  const settings = readSettings()
  const date = currentDate()
  const times = getDayTimes(date, settings)
  const tz = settings.timezone

  console.log(`logical day: ${date}   tracking start: ${settings.trackingStartDate}`)
  console.log(
    `${PRAYER_LABELS[PRAYER]} window: ${formatClock(times[PRAYER === 'fajr' ? 'fajr' : PRAYER], tz)} – ` +
      `${formatClock(PRAYER === 'fajr' ? times.sunrise : times.nextFajr, tz)}`
  )

  console.log('\nbefore:')
  for (const s of getPrayerStatuses(date, Date.now(), settings)) {
    console.log(`  ${PRAYER_LABELS[s.prayer].padEnd(8)} ${s.state}`)
  }

  if (!APPLY) {
    console.log('\n(dry run — set APPLY=1 to write)')
    closeDatabase()
    app.quit()
    return
  }

  const [h, m] = AT.split(':').map(Number)
  const at = zonedTimeToMs(date, h, m, tz)
  setMark(date, PRAYER, at)

  console.log(`\nwrote: ${date} ${PRAYER} done_at=${formatClock(at, tz)}`)
  console.log('\nafter:')
  for (const s of getPrayerStatuses(date, Date.now(), settings)) {
    const when = s.doneAt ? ` (${formatClock(s.doneAt, tz)})` : ''
    console.log(`  ${PRAYER_LABELS[s.prayer].padEnd(8)} ${s.state}${when}`)
  }
  console.log('\nmarks now:', JSON.stringify(getMarks(date)))

  closeDatabase()
  app.quit()
})
