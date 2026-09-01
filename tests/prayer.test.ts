import { describe, it, expect } from 'vitest'
import {
  buildWindows,
  statusFor,
  dayStatuses,
  isCheckable,
  currentWindow,
  nextWindow,
  isPerfectDay,
  isDaySettled,
  countDone,
  countLate,
  countPrayed,
  isMakeUpAble,
  isRecordable,
  MAKEUP_WINDOW_MS
} from '@shared/prayer'
import type { DayPrayerTimes } from '@shared/types'

const H = 3_600_000
const base = Date.UTC(2026, 2, 10, 0, 0, 0) // arbitrary anchor

/** A day shaped like a real one: fajr 05:00, sunrise 06:30, dhuhr 12:30, asr 15:45, maghrib 18:20, isha 19:40. */
const times: DayPrayerTimes = {
  date: '2026-03-10',
  fajr: base + 5 * H,
  sunrise: base + 6.5 * H,
  dhuhr: base + 12.5 * H,
  asr: base + 15.75 * H,
  maghrib: base + 18 * H + 20 * 60_000,
  isha: base + 19 * H + 40 * 60_000,
  nextFajr: base + 24 * H + 5 * H
}

describe('buildWindows', () => {
  it('closes the Fajr window at sunrise, not at Dhuhr', () => {
    const fajr = buildWindows(times)[0]
    expect(fajr.prayer).toBe('fajr')
    expect(fajr.start).toBe(times.fajr)
    expect(fajr.end).toBe(times.sunrise)
    expect(fajr.end).not.toBe(times.dhuhr)
  })

  it('chains each window to the next prayer', () => {
    const [, dhuhr, asr, maghrib, isha] = buildWindows(times)
    expect([dhuhr.start, dhuhr.end]).toEqual([times.dhuhr, times.asr])
    expect([asr.start, asr.end]).toEqual([times.asr, times.maghrib])
    expect([maghrib.start, maghrib.end]).toEqual([times.maghrib, times.isha])
    expect([isha.start, isha.end]).toEqual([times.isha, times.nextFajr])
  })

  it('leaves a gap between sunrise and Dhuhr where nothing is open', () => {
    const mid = times.sunrise + H
    expect(currentWindow(dayStatuses(times, mid, {}), mid)).toBeNull()
  })

  it('never produces a window that ends before it starts', () => {
    const broken: DayPrayerTimes = { ...times, sunrise: times.fajr - H }
    const fajr = buildWindows(broken)[0]
    expect(fajr.end).toBe(fajr.start)
  })
})

describe('statusFor', () => {
  const w = buildWindows(times)[2] // asr

  it('is upcoming before the window opens', () => {
    expect(statusFor(w, w.start - 1, null).state).toBe('upcoming')
  })

  it('is open exactly at the start instant', () => {
    expect(statusFor(w, w.start, null).state).toBe('open')
  })

  it('is still open one millisecond before the end', () => {
    expect(statusFor(w, w.end - 1, null).state).toBe('open')
  })

  it('is missed exactly at the end instant, because the end is exclusive', () => {
    expect(statusFor(w, w.end, null).state).toBe('missed')
  })

  it('stays missed forever once the window has closed', () => {
    expect(statusFor(w, w.end + 30 * 24 * H, null).state).toBe('missed')
  })

  it('offers a make-up while a missed prayer is still recent', () => {
    expect(statusFor(w, w.end, null).canMakeUp).toBe(true)
    expect(statusFor(w, w.end + MAKEUP_WINDOW_MS - 1, null).canMakeUp).toBe(true)
  })

  it('withdraws the offer once the make-up window has passed', () => {
    expect(statusFor(w, w.end + MAKEUP_WINDOW_MS, null).canMakeUp).toBe(false)
    expect(statusFor(w, w.end + 30 * 24 * H, null).canMakeUp).toBe(false)
  })

  it('never offers a make-up while the window is still open', () => {
    expect(statusFor(w, w.start, null).canMakeUp).toBe(false)
    expect(statusFor(w, w.end - 1, null).canMakeUp).toBe(false)
  })

  it('stays done forever once checked, long after the window closed', () => {
    const doneAt = w.start + 60_000
    expect(statusFor(w, w.end + 5 * H, doneAt).state).toBe('done')
    expect(statusFor(w, w.end + 365 * 24 * H, doneAt).doneAt).toBe(doneAt)
  })

  it('reports the time left until the window closes', () => {
    expect(statusFor(w, w.end - 90 * 60_000, null).msLeft).toBe(90 * 60_000)
    expect(statusFor(w, w.end + 60_000, null).msLeft).toBeLessThan(0)
  })
})

describe('late, the make-up state', () => {
  const w = buildWindows(times)[2] // asr

  it('reads a mark written after the window closed as late, not done', () => {
    const madeUp = w.end + 2 * H
    expect(statusFor(w, madeUp, madeUp).state).toBe('late')
  })

  it('keeps a mark written one millisecond inside the window as done', () => {
    const justInTime = w.end - 1
    expect(statusFor(w, w.end + H, justInTime).state).toBe('done')
  })

  it('treats a mark written exactly at the close instant as late', () => {
    expect(statusFor(w, w.end, w.end).state).toBe('late')
  })

  it('stays late forever — a make-up never ripens into an on-time prayer', () => {
    const madeUp = w.end + H
    expect(statusFor(w, w.end + 365 * 24 * H, madeUp).state).toBe('late')
  })

  it('lets a make-up be undone while the make-up window is open, and not after', () => {
    const madeUp = w.end + H
    expect(statusFor(w, madeUp, madeUp).canMakeUp).toBe(true)
    expect(statusFor(w, w.end + MAKEUP_WINDOW_MS, madeUp).canMakeUp).toBe(false)
  })

  it('never lets an on-time prayer be withdrawn after its window', () => {
    const inTime = w.start + 60_000
    expect(statusFor(w, w.end + H, inTime).canMakeUp).toBe(false)
  })
})

describe('isCheckable, the guard that makes missed permanent', () => {
  const w = buildWindows(times)[0]

  it('rejects a check before the window opens', () => {
    expect(isCheckable(w, w.start - 1)).toBe(false)
  })

  it('accepts a check inside the window', () => {
    expect(isCheckable(w, w.start)).toBe(true)
    expect(isCheckable(w, w.end - 1)).toBe(true)
  })

  it('rejects a retroactive check after the window closed', () => {
    expect(isCheckable(w, w.end)).toBe(false)
    expect(isCheckable(w, w.end + H)).toBe(false)
  })
})

describe('isMakeUpAble and isRecordable', () => {
  const w = buildWindows(times)[0]

  it('is not make-up-able before or during the window', () => {
    expect(isMakeUpAble(w, w.start - 1)).toBe(false)
    expect(isMakeUpAble(w, w.end - 1)).toBe(false)
  })

  it('is make-up-able from the close instant until the limit', () => {
    expect(isMakeUpAble(w, w.end)).toBe(true)
    expect(isMakeUpAble(w, w.end + MAKEUP_WINDOW_MS - 1)).toBe(true)
    expect(isMakeUpAble(w, w.end + MAKEUP_WINDOW_MS)).toBe(false)
  })

  it('is recordable across both the window and the make-up period', () => {
    expect(isRecordable(w, w.start - 1)).toBe(false)
    expect(isRecordable(w, w.start)).toBe(true)
    expect(isRecordable(w, w.end)).toBe(true)
    expect(isRecordable(w, w.end + MAKEUP_WINDOW_MS)).toBe(false)
  })
})

describe('Isha spans midnight', () => {
  it('is still open at 01:00 the next morning', () => {
    const oneAm = base + 25 * H
    const isha = dayStatuses(times, oneAm, {})[4]
    expect(isha.prayer).toBe('isha')
    expect(isha.state).toBe('open')
  })

  it('closes at the next morning Fajr', () => {
    const atNextFajr = times.nextFajr
    expect(dayStatuses(times, atNextFajr, {})[4].state).toBe('missed')
  })
})

describe('day-level helpers', () => {
  const allDone = {
    fajr: times.fajr + 60_000,
    dhuhr: times.dhuhr + 60_000,
    asr: times.asr + 60_000,
    maghrib: times.maghrib + 60_000,
    isha: times.isha + 60_000
  }

  it('counts a 5/5 day', () => {
    const st = dayStatuses(times, times.nextFajr, allDone)
    expect(countDone(st)).toBe(5)
    expect(isPerfectDay(st)).toBe(true)
  })

  it('does not call a day perfect when one window was missed', () => {
    const st = dayStatuses(times, times.nextFajr, { ...allDone, asr: null })
    expect(countDone(st)).toBe(4)
    expect(isPerfectDay(st)).toBe(false)
  })

  it('counts a made-up prayer as prayed but not as done', () => {
    const madeUp = { ...allDone, asr: times.maghrib + H }
    const st = dayStatuses(times, times.nextFajr, madeUp)
    expect(countDone(st)).toBe(4)
    expect(countLate(st)).toBe(1)
    expect(countPrayed(st)).toBe(5)
  })

  it('refuses to call a day perfect when a prayer was made up', () => {
    const madeUp = { ...allDone, asr: times.maghrib + H }
    expect(isPerfectDay(dayStatuses(times, times.nextFajr, madeUp))).toBe(false)
  })

  it('settles only once every window has closed', () => {
    expect(isDaySettled(dayStatuses(times, times.isha, {}), times.isha)).toBe(false)
    expect(isDaySettled(dayStatuses(times, times.nextFajr, {}), times.nextFajr)).toBe(true)
  })

  it('finds the open window and the next prayer', () => {
    const now = times.asr + 30 * 60_000
    const st = dayStatuses(times, now, {})
    expect(currentWindow(st, now)?.prayer).toBe('asr')
    expect(nextWindow(st, now)?.prayer).toBe('maghrib')
  })
})
