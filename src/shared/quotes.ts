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
  'Small steps still get you there.',
  'Start before you feel ready.',
  'The hard part is starting, and you have done it before.',
  'Do the next right thing, then the one after it.',
  'You do not have to be fast. Just do not stop.',
  'Today only asks for today.',
  'Being early is a kindness to yourself.',
  'Rest is part of the work, not a break from it.',
  'A quiet day, well spent, still counts.',
  'Keep your promises to yourself first.',
  'You can begin again at any hour.',
  'Patience is a skill, not a mood.',
  'Tidy room, clearer head.',
  'Sleep is tomorrow being built early.',
  'Water, air and a short walk fix more than you would think.',
  'Say less and mean more.',
  'Kindness costs nothing and comes back quietly.',
  'Gratitude turns enough into plenty.',
  'Someone is glad you are here today.',
  'Be good to the person you will be tomorrow.',
  'Finish one thing. It counts.',
  'Slow progress is still progress.',
  'Missing once is a moment, not a pattern.',
  'Falling short is not falling away.',
  'Begin again, gently.',
  'The day is long enough for what matters.',
  'Discipline is just care for your future self.',
  'Do it badly rather than not at all.',
  'One page at a time still finishes the book.',
  'Little and often wins.',
  'Guard your mornings.',
  'What you do daily matters more than what you do rarely.',
  'Protect your attention. It is most of your day.',
  'You are allowed to start over at noon.',
  'Effort counts even when the results are slow.',
  'Show up. That is most of it.',
  'Let today be simple.',
  'Be honest with yourself. It saves so much time.',
  'A calm mind gets more done than a rushed one.',
  'Do not trade tomorrow for tonight.',
  'Put the phone down and the day gets longer.',
  'Do the boring thing well.',
  'The second best time to begin is right now.',
  'Hard days pass. What you built stays.',
  'Keep the promise, even the small one.',
  'You will be glad you did this.',
  'Health is a habit long before it is a result.',
  'Move a little. It changes the whole mood.',
  'Say thank you more often than you think to.',
  'Forgive quickly and carry less.',
  'Your word is worth keeping.',
  'Take the day one step at a time.',
  'Quiet is good company.',
  'Learn one small thing today.',
  'Being on time is a form of respect.',
  'Clean start, clear day.',
  'Less scrolling, more living.',
  'Choose the harder right over the easier wrong.',
  'Sit with it for ten minutes. It gets easier.',
  'The day improves the moment you begin.'
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
