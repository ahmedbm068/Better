import { describe, it, expect } from 'vitest'
import {
  currentStreak,
  recordStreak,
  computeStreakInfo,
  appliesOnWeekday,
  maskFromWeekdays,
  weekdaysFromMask,
  ALL_DAYS_MASK
} from '@shared/streaks'
import type { StreakDay } from '@shared/streaks'
import { addDays } from '@shared/time'

/** Builds a day list from a compact string: D=done, x=missed, g=grace, -=not applicable, ?=pending. */
function days(spec: string, start = '2026-01-01'): StreakDay[] {
  return spec.split('').map((c, i) => ({
    date: addDays(start, i),
    applies: c !== '-',
    done: c === 'D',
    grace: c === 'g',
    pending: c === '?'
  }))
}

describe('currentStreak', () => {
  it('counts an unbroken run', () => {
    expect(currentStreak(days('DDDDD'))).toBe(5)
  })

  it('stops at the most recent miss', () => {
    expect(currentStreak(days('DDDxDD'))).toBe(2)
  })

  it('is zero right after a miss', () => {
    expect(currentStreak(days('DDDx'))).toBe(0)
  })

  it('skips days the habit does not apply to', () => {
    // Gym on Mon/Wed/Fri: the off days must not break anything.
    expect(currentStreak(days('D--D--D'))).toBe(3)
  })

  it('does not break on a day still in progress', () => {
    expect(currentStreak(days('DDD?'))).toBe(3)
  })

  it('lets a grace day carry the run without inflating it', () => {
    expect(currentStreak(days('DDgDD'))).toBe(4)
  })

  it('still breaks on a real miss even when a grace day exists earlier', () => {
    expect(currentStreak(days('DDgDDxD'))).toBe(1)
  })

  it('handles an empty history', () => {
    expect(currentStreak([])).toBe(0)
  })
})

describe('recordStreak', () => {
  it('keeps the best run after the current one breaks', () => {
    expect(recordStreak(days('DDDDDxD'))).toBe(5)
    expect(currentStreak(days('DDDDDxD'))).toBe(1)
  })

  it('finds the best run anywhere in the history', () => {
    expect(recordStreak(days('DDxDDDDxD'))).toBe(4)
  })

  it('never reports a record below the run in progress', () => {
    const info = computeStreakInfo(days('DDD'))
    expect(info.current).toBe(3)
    expect(info.record).toBe(3)
  })

  it('reports grace availability when asked', () => {
    expect(computeStreakInfo(days('DD'), true).graceAvailable).toBe(true)
    expect(computeStreakInfo(days('DD'), false).graceAvailable).toBe(false)
    expect(computeStreakInfo(days('DD')).graceAvailable).toBeUndefined()
  })
})

describe('weekday masks', () => {
  it('round-trips weekdays through a mask', () => {
    const mask = maskFromWeekdays([1, 3, 5]) // Mon, Wed, Fri
    expect(weekdaysFromMask(mask)).toEqual([1, 3, 5])
    expect(appliesOnWeekday(mask, 1)).toBe(true)
    expect(appliesOnWeekday(mask, 2)).toBe(false)
  })

  it('matches every weekday with the all-days mask', () => {
    for (let d = 0; d < 7; d++) expect(appliesOnWeekday(ALL_DAYS_MASK, d)).toBe(true)
    expect(weekdaysFromMask(ALL_DAYS_MASK)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })
})
