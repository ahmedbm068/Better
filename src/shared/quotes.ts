/**
 * The quote of the day.
 *
 * ── Rules for anything added to this list ──────────────────────────────────
 *
 * These are read by a Muslim user, every single day, and they must never say
 * anything he would have to disagree with. So:
 *
 *  1. **Nothing that touches belief.** No God, no divinity, no soul-talk, no
 *     worship, and above all nothing that hands power to something else — no
 *     universe that "provides", no fate, destiny, karma, luck, stars or
 *     manifesting. That is the kufr line and this file does not go near it.
 *  2. **No claims over outcomes.** "You decide your future", "you control what
 *     happens" — a Muslim holds that outcomes are with Allah. Every line here
 *     is about *effort and conduct*, which is the part that is ours.
 *  3. **No scripture.** Not the Qur'an, not a hadith, not a paraphrase of
 *     either. A half-remembered translation shown as a daily card is a real
 *     harm, and there is no way to do it safely from here.
 *  4. **No attribution.** Quote lists are famous for putting words in dead
 *     people's mouths. These are plain unattributed lines, so there is nobody
 *     to misquote.
 *  5. **Nothing haram in passing** — no drink, no gambling, no romance.
 *  6. **Kind, never scolding.** The app never shames a missed day, and neither
 *     does this.
 *  7. **Two lines at most.** Enforced by MAX_LENGTH and by the tests.
 *
 * `tests/quotes.test.ts` enforces 1, 5 and 7 mechanically. It cannot enforce
 * good taste, so read the list before adding to it.
 */
import type { DateStr } from './types'

/** Long enough for a thought, short enough for two lines in the card. */
export const MAX_LENGTH = 66

export const QUOTES: readonly string[] = [
  'Discipline is doing it even when you do not feel like it.',
  'Motivation gets you started. Habits keep you going.',
  'Show up especially on the days you do not want to.',
  'Small daily wins build a record nothing can take away.',
  'You will not always feel ready. Begin anyway.',
  'Comfort rarely builds anything worth having.',
  'Consistency beats intensity, almost every time.',
  'Be someone your future self is proud to inherit.',
  'Discipline today buys freedom tomorrow.',
  'Do the hard thing before the day talks you out of it.',
  'Effort compounds when you keep adding to it.',
  "The person you become starts with today's choices.",
  'Excuses are light to carry. Regret is not.',
  'Push a little past where quitting feels reasonable.',
  'Strong habits are built in the boring moments.',
  'Win the morning and the day tends to follow.',
  'Feelings are optional. Showing up is not.',
  'Every page, every rep, every step adds up.',
  'Beat yesterday. That is the whole game.',
  'Discomfort now often becomes confidence later.',
  'Stop negotiating with your own excuses.',
  'Momentum is built one small decision at a time.',
  'Make today count for something.',
  'You are one decision away from a different day.',
  'Grit is choosing to continue once it gets boring.',
  'The work does not care how you feel about it.',
  'Do it nervous. Do it tired. Just do it.',
  'Small steps, repeated daily, move mountains.',
  'Your standards quietly decide your results.',
  'Progress hides inside repetition.',
  'Treat discipline like a muscle. Use it today.',
  'Nothing changes until something changes.',
  'Choose hard now, or harder later.',
  'Focus outworks talent that never shows up.',
  'You are stronger than the excuse you just made.',
  'Finish the thing you started this morning.',
  'Today is a small vote for who you are becoming.',
  'Get comfortable with a little discomfort.',
  'The best time to start was earlier. Start now.',
  'Quiet effort tends to outlast loud intentions.',
  'Do not wait to feel motivated. Start moving.',
  'Every expert began as a beginner who kept going.',
  'Compete with who you were yesterday, not others.',
  'Hard days build strength regret cannot reach.',
  'Keep the promise you made to yourself.',
  'Ordinary effort, repeated, becomes extraordinary.',
  'Stack one good day on top of the last.',
  'Habits carry you further than willpower alone.',
  'A little progress each day adds up to a lot.',
  'Be relentless about the things that matter.',
  'Your future is built in ordinary afternoons.',
  'Give the work everything you have. That much is yours to give.',
  'Not motivated? Start anyway. It tends to follow.',
  'The comeback is usually stronger than the setback.',
  'Discipline is a quiet form of self-respect.',
  'Say less, prove more.',
  'A rough start is still a start. Keep going.',
  'Trade an easy no for a harder yes, today.',
  'You only have to be one percent better today.',
  'The hard choice today tends to make for an easier week.',
  'Stop waiting for a perfect moment. Move now.',
  'What you repeat, you become.',
  'Chase progress. Perfection can wait.',
  'One honest rep beats a perfect plan you never start.',
  'Effort is the one thing always in your control.',
  'Be stubborn about your goals, flexible about the plan.',
  'Do not let a hard morning decide your whole day.',
  'Own the process. That is the part that is yours.',
  'Keep going, especially when it feels invisible.',
  "Today's discomfort can be tomorrow's strength.",
  'Small, consistent action beats big empty plans.',
  'Get one percent better and call it a good day.',
  'You do not need permission to start over today.',
  'Be the kind of person who finishes what they start.',
  'Push through the middle, where most people quit.',
  'Do the work today your future self will thank you for.',
  'One good decision tends to make the next one easier.',
  'The floor is showing up. Everything else builds from there.'
]

/**
 * The step between one day's quote and the next.
 *
 * Walking the list in order would be predictable, and a plain hash of the date
 * can repeat within the same week. A stride coprime with the list length visits
 * every quote exactly once before repeating any — so there is no repeat for
 * QUOTES.length days — while consecutive days land far apart and feel picked
 * rather than counted. The test holds the two coprime.
 */
export const STRIDE = 23

/** Whole days since the epoch, from the calendar date alone. */
function dayNumber(date: DateStr): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

/**
 * The quote for a given day.
 *
 * Deterministic: the same date always gives the same line, so it does not
 * change under the reader while they are looking at it, and it is the same on
 * every device without anything needing to be synced.
 */
export function quoteForDate(date: DateStr): string {
  const n = dayNumber(date)
  if (!Number.isFinite(n)) return QUOTES[0]
  // Modulo of a negative number stays negative in JS; dates before 1970 are
  // not expected, but a wrapped index would throw rather than degrade.
  const index = (((n * STRIDE) % QUOTES.length) + QUOTES.length) % QUOTES.length
  return QUOTES[index]
}
