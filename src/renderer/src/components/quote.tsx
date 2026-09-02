/**
 * The quote of the day: a card on Today, and the moment it arrives.
 *
 * On opening the app the quote is shown once, full screen, large enough to
 * actually be read — then it settles into the small card it lives in for the
 * rest of the day. The flight is the point: it tells you where the thing went,
 * so the card is never a surprise afterwards.
 *
 * It is skippable with a click or Escape, and with reduced motion it is not
 * shown at all — the card alone carries the quote.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { DateStr } from '@shared/types'
import { quoteForDate } from '@shared/quotes'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { IconQuote } from './icons'
import { Panel } from './ui'

/** The card is the flight's destination, so it has to be findable. */
export const QUOTE_CARD_ID = 'quote-of-the-day'

const EASE = 'cubic-bezier(.22,1,.36,1)'

/* ---------------------------------------------------------------- the card */

export function QuoteCard({ date }: { date: DateStr }): React.JSX.Element {
  const quote = quoteForDate(date)
  return (
    <div id={QUOTE_CARD_ID}>
      <Panel title="Quote of the day">
        <div className="relative">
          <IconQuote
            size={22}
            className="absolute top-0 left-0 text-accent opacity-30"
            aria-hidden="true"
          />
          <p className="relative pl-8 pt-0.5 text-[14.5px] leading-relaxed text-fg">{quote}</p>
        </div>
      </Panel>
    </div>
  )
}

/* --------------------------------------------------------------- the intro */

type Stage = 'reveal' | 'hold' | 'fly'

const LABEL_IN = 320
const WORD_STEP = 55
const WORD_IN = 420
/** How long the finished quote sits still, so it can actually be read. */
const HOLD = 2000
const FLY = 780

export function QuoteIntro(): React.JSX.Element | null {
  const { data: date } = useAsync(() => api.currentDate(), [])
  const [stage, setStage] = useState<Stage>('reveal')
  const [done, setDone] = useState(false)
  const [flight, setFlight] = useState<CSSProperties | null>(null)
  const blockRef = useRef<HTMLDivElement>(null)

  // Someone who has asked for less motion should not be shown a four-second
  // animation on every launch. The card still has the quote.
  const still = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
    []
  )

  const words = date ? quoteForDate(date).split(' ') : []
  const revealMs = LABEL_IN + words.length * WORD_STEP + WORD_IN

  // The clock only starts once there is a quote to show.
  useEffect(() => {
    if (!date || still) return
    const id = setTimeout(() => setStage('hold'), revealMs)
    return () => clearTimeout(id)
  }, [date, still, revealMs])

  useEffect(() => {
    if (stage !== 'hold') return
    const id = setTimeout(() => setStage('fly'), HOLD)
    return () => clearTimeout(id)
  }, [stage])

  /*
   * The flight.
   *
   * Measured rather than guessed: the overlay's own block and the card are both
   * read off the layout, so the quote lands on the card wherever the window
   * size has put it. With no card on screen — another page, a stray render —
   * it simply falls away in place.
   */
  useEffect(() => {
    if (stage !== 'fly') return
    const block = blockRef.current
    const target = document.getElementById(QUOTE_CARD_ID)

    if (block && target) {
      // On a short window the card sits below the fold, and the quote would fly
      // off the bottom of the screen to reach it. Bringing it into view first
      // costs nothing — the page is behind a full-screen overlay, so the jump
      // is not seen — and it means the landing always happens where you can
      // watch it. Instant, not smooth: a moving target cannot be measured.
      target.scrollIntoView({ block: 'nearest', behavior: 'auto' })

      const from = block.getBoundingClientRect()
      const to = target.getBoundingClientRect()
      if (from.width > 0 && to.width > 0) {
        const scale = Math.min(1, to.width / from.width)
        setFlight({
          transform: `translate(${to.left + to.width / 2 - (from.left + from.width / 2)}px, ${
            to.top + to.height / 2 - (from.top + from.height / 2)
          }px) scale(${scale})`,
          opacity: 0,
          transition: `transform ${FLY}ms ${EASE}, opacity ${FLY}ms ease-in`
        })
      }
    }
    if (!flight) {
      setFlight((f) => f ?? { opacity: 0, transition: `opacity ${FLY}ms ease` })
    }

    const id = setTimeout(() => setDone(true), FLY)
    return () => clearTimeout(id)
    // `flight` is written here, never read as a dependency: adding it would
    // restart the timer the moment the transform lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  // Escape, or a click anywhere, sends it on its way early.
  useEffect(() => {
    if (still || done) return
    const skip = (): void => setStage((s) => (s === 'fly' ? s : 'fly'))
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') skip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [still, done])

  if (still || done || !date) return null

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseDown={() => setStage('fly')}
      style={{ transition: `opacity ${FLY}ms ease` }}
      className={`fixed inset-0 z-[60] grid place-items-center px-8 cursor-pointer
        bg-bg/92 backdrop-blur-md ${stage === 'fly' ? 'opacity-0' : 'opacity-100'}`}
    >
      <div ref={blockRef} style={flight ?? undefined} className="max-w-[640px] text-center">
        <div
          className="kicker text-accent"
          style={{ animation: `rise ${LABEL_IN}ms ${EASE} both` }}
        >
          Quote of the day
        </div>

        <p className="mt-5 text-[32px] leading-[1.3] font-semibold tracking-[-0.02em] text-balance">
          {words.map((word, i) => (
            <span
              key={i}
              className="inline-block"
              style={{
                animation: `rise ${WORD_IN}ms ${EASE} both`,
                animationDelay: `${LABEL_IN + i * WORD_STEP}ms`
              }}
            >
              {word}
              {i < words.length - 1 && ' '}
            </span>
          ))}
        </p>

        <div
          className="micro mt-7"
          style={{
            animation: `fade 500ms ease both`,
            animationDelay: `${revealMs}ms`
          }}
        >
          Tap anywhere to continue
        </div>
      </div>
    </div>
  )
}
