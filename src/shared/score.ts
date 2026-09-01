/**
 * Daily score, out of 100.
 *
 *   Prayers  40  (8 per prayer done in time, 3 per one made up late)
 *   Habits   25  (proportional to applicable habits completed)
 *   Avoid    20  (proportional to items with no slip)
 *   Sleep    10  (both ends within tolerance of target)
 *   Work      5  (at least one session)
 *
 * A grace day protects a streak, not the score — using one still shows up
 * honestly here.
 */
import type { ScoreBreakdown } from './types'

export const SCORE_WEIGHTS = { prayers: 40, habits: 25, avoid: 20, sleep: 10, work: 5 } as const
export const POINTS_PER_PRAYER = 8

/**
 * A made-up prayer earns less than one prayed on time, and the gap is the
 * point: qada is a real recovery, not an eraser. Three of eight — enough that
 * making one up plainly beats abandoning it, far short of never having missed.
 */
export const POINTS_PER_LATE_PRAYER = 3

export interface ScoreInput {
  prayersDone: number
  prayersLate: number
  habitsApplicable: number
  habitsDone: number
  avoidActive: number
  avoidClean: number
  sleepOnTarget: boolean
  hasWorkSession: boolean
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export function computeScore(input: ScoreInput): ScoreBreakdown {
  // Capped at the category weight, so five made up plus a miscount can never
  // out-earn five kept.
  const prayers = Math.min(
    SCORE_WEIGHTS.prayers,
    clamp(input.prayersDone, 0, 5) * POINTS_PER_PRAYER +
      clamp(input.prayersLate, 0, 5) * POINTS_PER_LATE_PRAYER
  )

  // With nothing to track, the category is not held against the day.
  const habits =
    input.habitsApplicable > 0
      ? Math.round(SCORE_WEIGHTS.habits * clamp(input.habitsDone / input.habitsApplicable, 0, 1))
      : SCORE_WEIGHTS.habits

  const avoid =
    input.avoidActive > 0
      ? Math.round(SCORE_WEIGHTS.avoid * clamp(input.avoidClean / input.avoidActive, 0, 1))
      : SCORE_WEIGHTS.avoid

  const sleep = input.sleepOnTarget ? SCORE_WEIGHTS.sleep : 0
  const work = input.hasWorkSession ? SCORE_WEIGHTS.work : 0

  return { prayers, habits, avoid, sleep, work, total: prayers + habits + avoid + sleep + work }
}

export const emptyScore = (): ScoreBreakdown => ({
  prayers: 0,
  habits: 0,
  avoid: 0,
  sleep: 0,
  work: 0,
  total: 0
})
