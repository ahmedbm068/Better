/** Prayer display: the countdown hero, the five-row list, and the dot strip. */
import type { PrayerState, PrayerStatus } from '@shared/types'
import { PRAYER_LABELS } from '@shared/types'
import { formatClock, formatDurationShort } from '@shared/format'
import { Button } from './ui'

export const STATE_COLOR: Record<PrayerState, string> = {
  done: 'bg-done',
  late: 'bg-late',
  missed: 'bg-missed',
  open: 'bg-accent',
  upcoming: 'bg-wait'
}

const STATE_TEXT: Record<PrayerState, string> = {
  done: 'text-done',
  late: 'text-late',
  missed: 'text-missed',
  open: 'text-accent',
  upcoming: 'text-faint'
}

/** Five dots — the compact summary used in the calendar and the header. */
export function PrayerDots({
  states,
  size = 6
}: {
  states: PrayerState[] | string[]
  size?: number
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-[3px]">
      {states.map((s, i) => (
        <span
          key={i}
          className={`rounded-full ${STATE_COLOR[s as PrayerState] ?? 'bg-wait'}`}
          style={{ width: size, height: size }}
        />
      ))}
    </span>
  )
}

/**
 * The single most important thing on screen: which window is open and how long
 * is left in it. Falls back to the wait until the next window opens.
 */
export function PrayerHero({
  statuses,
  now,
  tz,
  onCheck
}: {
  statuses: PrayerStatus[]
  now: number
  tz: string
  onCheck: (prayer: PrayerStatus) => void
}): React.JSX.Element {
  const open = statuses.find((s) => now >= s.start && now < s.end) ?? null
  const next = statuses.filter((s) => s.start > now).sort((a, b) => a.start - b.start)[0] ?? null

  if (open) {
    const left = open.end - now
    const span = Math.max(1, open.end - open.start)
    const elapsedPct = Math.min(100, Math.max(0, ((now - open.start) / span) * 100))
    const urgent = open.state !== 'done' && left <= 15 * 60_000

    return (
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="label mb-1.5">Window open</div>
            <div className="flex items-baseline gap-3">
              <span className="num text-3xl font-semibold tracking-tight">
                {PRAYER_LABELS[open.prayer]}
              </span>
              {open.state === 'done' && <span className="text-done text-[12px]">checked</span>}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="label mb-1.5">Left</div>
            <div
              className={`num text-3xl font-semibold tabular-nums ${
                open.state === 'done' ? 'text-dim' : urgent ? 'text-missed' : 'text-accent'
              } ${urgent ? 'pulse' : ''}`}
            >
              {formatDurationShort(left)}
            </div>
          </div>
        </div>

        <div className="mt-3 h-[4px] bg-wait rounded-full overflow-hidden">
          <div
            className={open.state === 'done' ? 'h-full bg-done' : 'h-full bg-accent'}
            style={{ width: `${elapsedPct}%` }}
          />
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-3">
          <span className="num text-[11px] text-faint">
            closes {formatClock(open.end, tz)}
            {next && ` · next ${PRAYER_LABELS[next.prayer]} ${formatClock(next.start, tz)}`}
          </span>
          {open.state !== 'done' && (
            <Button variant="primary" size="sm" onClick={() => onCheck(open)}>
              Check {PRAYER_LABELS[open.prayer]}
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="label mb-1.5">No window open</div>
          <div className="num text-3xl font-semibold tracking-tight">
            {next ? PRAYER_LABELS[next.prayer] : '—'}
          </div>
        </div>
        <div className="text-right">
          <div className="label mb-1.5">Opens in</div>
          <div className="num text-3xl font-semibold text-dim tabular-nums">
            {next ? formatDurationShort(next.start - now) : '—'}
          </div>
        </div>
      </div>
      <div className="mt-3 num text-[11px] text-faint">
        {next ? `at ${formatClock(next.start, tz)}` : 'All windows for this day have closed.'}
      </div>
    </div>
  )
}

/** The five prayers with their times, states, and an in-window check control. */
export function PrayerList({
  statuses,
  now,
  tz,
  onCheck,
  onUncheck,
  readOnly = false,
  untracked = false
}: {
  statuses: PrayerStatus[]
  now: number
  tz: string
  onCheck?: (prayer: PrayerStatus) => void
  onUncheck?: (prayer: PrayerStatus) => void
  readOnly?: boolean
  /** A day before the app existed: show the times, pass no judgement. */
  untracked?: boolean
}): React.JSX.Element {
  return (
    <ul className="divide-y divide-line">
      {statuses.map((s) => {
        const live = !readOnly && !untracked
        const inWindow = live && now >= s.start && now < s.end
        // The window has closed but the prayer can still be recorded as made up.
        const makeUp = live && s.canMakeUp
        return (
          <li key={s.prayer} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                untracked ? 'bg-wait' : STATE_COLOR[s.state]
              }`}
            />
            <span className="w-[74px] shrink-0">{PRAYER_LABELS[s.prayer]}</span>
            <span className="num text-dim w-[46px] shrink-0">{formatClock(s.start, tz)}</span>
            <span
              className={`text-[11px] flex-1 truncate ${untracked ? 'text-faint' : STATE_TEXT[s.state]}`}
            >
              {untracked && 'not tracked'}
              {!untracked && s.state === 'done' && `checked ${formatClock(s.doneAt, tz)}`}
              {!untracked && s.state === 'late' && `made up ${formatClock(s.doneAt, tz)}`}
              {!untracked && s.state === 'missed' && 'missed'}
              {!untracked && s.state === 'open' && `${formatDurationShort(s.end - now)} left`}
              {!untracked && s.state === 'upcoming' && `until ${formatClock(s.end, tz)}`}
            </span>
            {inWindow && s.state !== 'done' && (
              <Button size="sm" onClick={() => onCheck?.(s)}>
                Check
              </Button>
            )}
            {makeUp && s.state === 'missed' && (
              <Button
                size="sm"
                onClick={() => onCheck?.(s)}
                title="Record this as prayed after its window closed"
              >
                Made up
              </Button>
            )}
            {((inWindow && s.state === 'done') || (makeUp && s.state === 'late')) && (
              <Button size="sm" variant="ghost" onClick={() => onUncheck?.(s)} title="Undo">
                Undo
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
