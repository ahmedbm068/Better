import { describe, it, expect } from 'vitest'
import { computeScore, SCORE_WEIGHTS } from '@shared/score'

const input = {
  prayersDone: 0,
  habitsApplicable: 0,
  habitsDone: 0,
  avoidActive: 0,
  avoidClean: 0,
  sleepOnTarget: false,
  hasWorkSession: false
}

describe('computeScore', () => {
  it('gives a perfect day exactly 100', () => {
    const s = computeScore({
      prayersDone: 5,
      habitsApplicable: 6,
      habitsDone: 6,
      avoidActive: 4,
      avoidClean: 4,
      sleepOnTarget: true,
      hasWorkSession: true
    })
    expect(s).toEqual({ prayers: 40, habits: 25, avoid: 20, sleep: 10, work: 5, total: 100 })
  })

  it('gives an empty day zero, except for categories with nothing to track', () => {
    expect(computeScore(input).total).toBe(SCORE_WEIGHTS.habits + SCORE_WEIGHTS.avoid)
  })

  it('awards 8 points per prayer done in time', () => {
    for (let n = 0; n <= 5; n++) {
      expect(computeScore({ ...input, prayersDone: n }).prayers).toBe(n * 8)
    }
  })

  it('caps prayers at 40 even with bad input', () => {
    expect(computeScore({ ...input, prayersDone: 9 }).prayers).toBe(40)
    expect(computeScore({ ...input, prayersDone: -2 }).prayers).toBe(0)
  })

  it('scales habits proportionally', () => {
    expect(computeScore({ ...input, habitsApplicable: 4, habitsDone: 2 }).habits).toBe(13)
    expect(computeScore({ ...input, habitsApplicable: 4, habitsDone: 0 }).habits).toBe(0)
    expect(computeScore({ ...input, habitsApplicable: 3, habitsDone: 3 }).habits).toBe(25)
  })

  it('scales the avoid list by items with no slip', () => {
    expect(computeScore({ ...input, avoidActive: 4, avoidClean: 3 }).avoid).toBe(15)
    expect(computeScore({ ...input, avoidActive: 4, avoidClean: 0 }).avoid).toBe(0)
  })

  it('treats sleep and work as all-or-nothing', () => {
    expect(computeScore({ ...input, sleepOnTarget: true }).sleep).toBe(10)
    expect(computeScore({ ...input, hasWorkSession: true }).work).toBe(5)
  })

  it('produces the documented 3/5-prayer example', () => {
    const s = computeScore({
      prayersDone: 3,
      habitsApplicable: 6,
      habitsDone: 4,
      avoidActive: 4,
      avoidClean: 4,
      sleepOnTarget: false,
      hasWorkSession: true
    })
    expect(s.total).toBe(24 + 17 + 20 + 0 + 5)
  })

  it('never exceeds 100 for any combination', () => {
    for (let p = 0; p <= 5; p++) {
      for (let h = 0; h <= 6; h++) {
        const s = computeScore({
          prayersDone: p,
          habitsApplicable: 6,
          habitsDone: h,
          avoidActive: 4,
          avoidClean: 4,
          sleepOnTarget: true,
          hasWorkSession: true
        })
        expect(s.total).toBeLessThanOrEqual(100)
        expect(s.total).toBeGreaterThanOrEqual(0)
      }
    }
  })
})
