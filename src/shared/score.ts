/**
 * Daily score, out of 100.
 *
 *   Prayers  40  (8 per prayer done in time)
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

export interface ScoreInput {
  prayersDone: number
  habitsApplicable: number
  habitsDone: number
  avoidActive: number
  avoidClean: number
  sleepOnTarget: boolean
  hasWorkSession: boolean
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export function computeScore(input: ScoreInput): ScoreBreakdown {
  const prayers = clamp(input.prayersDone, 0, 5) * POINTS_PER_PRAYER

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
