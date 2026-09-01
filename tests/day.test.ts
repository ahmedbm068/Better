import { describe, it, expect } from 'vitest'
import { logicalDate, logicalDayStart, logicalDayEnd, isWithinLogicalDay } from '@shared/day'
import { zonedTimeToMs, dateStrInZone, addDays, daysBetween } from '@shared/time'
import type { DateStr } from '@shared/types'

const TZ = 'Africa/Tunis'

/** Fajr at 05:00 local, every day. */
const fajrAt5 = (date: DateStr) => zonedTimeToMs(date, 5, 0, TZ)

describe('logicalDate: the day rolls over at Fajr, not midnight', () => {
  it('places 01:00 in the previous logical day', () => {
    const oneAm = zonedTimeToMs('2026-03-11', 1, 0, TZ)
    expect(dateStrInZone(oneAm, TZ)).toBe('2026-03-11')
    expect(logicalDate(oneAm, fajrAt5, { tz: TZ })).toBe('2026-03-10')
  })

  it('places 23:00 in that same logical day', () => {
    const late = zonedTimeToMs('2026-03-10', 23, 0, TZ)
    expect(logicalDate(late, fajrAt5, { tz: TZ })).toBe('2026-03-10')
  })

  it('rolls over exactly at Fajr', () => {
    const fajr = fajrAt5('2026-03-11')
    expect(logicalDate(fajr - 1, fajrAt5, { tz: TZ })).toBe('2026-03-10')
    expect(logicalDate(fajr, fajrAt5, { tz: TZ })).toBe('2026-03-11')
  })

  it('treats midnight itself as still the previous day', () => {
    const midnight = zonedTimeToMs('2026-03-11', 0, 0, TZ)
    expect(logicalDate(midnight, fajrAt5, { tz: TZ })).toBe('2026-03-10')
  })

  it('honours a positive boundary offset', () => {
    const at0510 = zonedTimeToMs('2026-03-11', 5, 10, TZ)
    expect(logicalDate(at0510, fajrAt5, { tz: TZ, offsetMin: 0 })).toBe('2026-03-11')
    expect(logicalDate(at0510, fajrAt5, { tz: TZ, offsetMin: 30 })).toBe('2026-03-10')
  })

  it('honours a negative boundary offset', () => {
    const at0450 = zonedTimeToMs('2026-03-11', 4, 50, TZ)
    expect(logicalDate(at0450, fajrAt5, { tz: TZ, offsetMin: 0 })).toBe('2026-03-10')
    expect(logicalDate(at0450, fajrAt5, { tz: TZ, offsetMin: -30 })).toBe('2026-03-11')
  })
})

describe('logical day bounds', () => {
  it('runs from one Fajr to the next', () => {
    const start = logicalDayStart('2026-03-10', fajrAt5, { tz: TZ })
    const end = logicalDayEnd('2026-03-10', fajrAt5, { tz: TZ })
    expect(start).toBe(fajrAt5('2026-03-10'))
    expect(end).toBe(fajrAt5('2026-03-11'))
    expect(end - start).toBe(24 * 3_600_000)
  })

  it('meets the next day exactly, with no gap or overlap', () => {
    const end = logicalDayEnd('2026-03-10', fajrAt5, { tz: TZ })
    const nextStart = logicalDayStart('2026-03-11', fajrAt5, { tz: TZ })
    expect(end).toBe(nextStart)
    expect(isWithinLogicalDay(end, '2026-03-10', fajrAt5, { tz: TZ })).toBe(false)
    expect(isWithinLogicalDay(end, '2026-03-11', fajrAt5, { tz: TZ })).toBe(true)
  })

  it('contains a 01:00 sleep timestamp in the previous day', () => {
    const bedtime = zonedTimeToMs('2026-03-11', 1, 0, TZ)
    expect(isWithinLogicalDay(bedtime, '2026-03-10', fajrAt5, { tz: TZ })).toBe(true)
    expect(isWithinLogicalDay(bedtime, '2026-03-11', fajrAt5, { tz: TZ })).toBe(false)
  })
})

describe('rollover across a DST transition', () => {
  // Africa/Tunis does not observe DST; Europe/Paris springs forward 2026-03-29.
  const PARIS = 'Europe/Paris'
  const parisFajr = (date: DateStr) => zonedTimeToMs(date, 5, 0, PARIS)

  it('still rolls over at local 05:00 on the spring-forward day', () => {
    const before = zonedTimeToMs('2026-03-29', 4, 30, PARIS)
    const after = zonedTimeToMs('2026-03-29', 5, 30, PARIS)
    expect(logicalDate(before, parisFajr, { tz: PARIS })).toBe('2026-03-28')
    expect(logicalDate(after, parisFajr, { tz: PARIS })).toBe('2026-03-29')
  })

  it('produces a 23-hour logical day when the clocks jump forward', () => {
    const prevStart = logicalDayStart('2026-03-28', parisFajr, { tz: PARIS })
    const start = logicalDayStart('2026-03-29', parisFajr, { tz: PARIS })
    const end = logicalDayEnd('2026-03-29', parisFajr, { tz: PARIS })
    expect(start - prevStart).toBe(23 * 3_600_000)
    expect(end - start).toBe(24 * 3_600_000)
  })
})

describe('a real Fajr that drifts day to day', () => {
  // Fajr creeping a minute earlier each day must not create gaps or overlaps.
  const drifting = (date: DateStr) => {
    const dayIndex = daysBetween('2026-04-01', date)
    return zonedTimeToMs(date, 5, 0, TZ) - dayIndex * 60_000
  }

  it('keeps every instant in exactly one logical day', () => {
    let cursor = zonedTimeToMs('2026-04-01', 6, 0, TZ)
    for (let i = 0; i < 200; i++) {
      const d = logicalDate(cursor, drifting, { tz: TZ })
      expect(isWithinLogicalDay(cursor, d, drifting, { tz: TZ })).toBe(true)
      expect(isWithinLogicalDay(cursor, addDays(d, 1), drifting, { tz: TZ })).toBe(false)
      expect(isWithinLogicalDay(cursor, addDays(d, -1), drifting, { tz: TZ })).toBe(false)
      cursor += 3.7 * 3_600_000
    }
  })
})
