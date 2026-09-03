/**
 * The day, drawn as an arc.
 *
 * The old build showed the day as a flat 24-hour ruler with the prayer windows
 * as blocks along it. It was accurate and it read like a Gantt chart. This is
 * the same data on the shape the day actually has: a rise and a fall, with the
 * five windows laid on it and the present moment travelling along.
 *
 * The countdown sits inside the bowl, so the one number that matters is
 * enclosed by the context that explains it.
 *
 * Geometry: an upper semicircle of radius R about (CX, CY) in a fixed viewBox.
 *
 * The arc spans Fajr to the close of Isha, not midnight to midnight. Mapping a
 * calendar day would spend half the curve on hours in which nothing can happen,
 * and this app's own day already begins at Fajr — it is what the rollover is
 * set to. So the five windows fill the whole bow, and the marker's position
 * along it is a reading of the day rather than of the clock.
 */
import { useId } from 'react'
import type { PrayerStatus, Settings } from '@shared/types'
import { PRAYER_LABELS } from '@shared/types'
import { formatClock } from '@shared/format'

/*
 * A 140-degree bow rather than a half circle.
 *
 * A semicircle is as tall as it is wide by definition, which made the card a
 * narrow column of curve floating in empty margins. Flattening the sweep keeps
 * the reading — a rise, a peak, a fall — at a third of the height, so the arc
 * can be wide enough to own the card.
 */
const W = 600
const H = 230
const CX = 300
const CY = 314
const R = 300
/** Half the sweep, in radians: the arc runs from CY+70° round to CY-70°. */
const HALF = (70 * Math.PI) / 180

/** The inset at each end of a window band, as a fraction of the arc. */
const GAP = 0.009

interface Point {
  x: number
  y: number
}

function at(t: number, radius = R): Point {
  const a = Math.PI / 2 + HALF - Math.max(0, Math.min(1, t)) * 2 * HALF
  return { x: CX + radius * Math.cos(a), y: CY - radius * Math.sin(a) }
}

function arcPath(t0: number, t1: number, radius = R): string {
  const a = at(t0, radius)
  const b = at(t1, radius)
  // The sweep never reaches 180 degrees, so the large-arc flag is always 0.
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`
}

const STATE_COLOR: Record<PrayerStatus['state'], string> = {
  done: 'var(--done)',
  late: 'var(--late)',
  missed: 'var(--missed)',
  open: 'var(--accent)',
  // A window that has not opened still has to be legible against the day bar
  // it sits on, which `--line2` is a shade too close to.
  upcoming: 'color-mix(in oklab, var(--text3) 52%, var(--wait))'
}

/** The span the arc covers, with a margin so the end caps are not clipped. */
function domain(prayers: PrayerStatus[]): { from: number; to: number } {
  const from = prayers[0].start
  const last = prayers[prayers.length - 1]
  // Isha can close after midnight; a close that reads as earlier than its own
  // opening has wrapped, so carry it to the following day.
  const to = last.end > last.start ? last.end : last.end + 86_400_000
  const margin = (to - from) * 0.035
  return { from: from - margin, to: to + margin }
}

export function DayArc({
  prayers,
  now,
  settings,
  children
}: {
  prayers: PrayerStatus[]
  now: number
  settings: Settings
  /** The countdown block, rendered inside the bowl. */
  children: React.ReactNode
}): React.JSX.Element {
  const uid = useId().replace(/:/g, '')
  const tz = settings.timezone
  const { from, to } = domain(prayers)
  const t = (ms: number): number => Math.max(0, Math.min(1, (ms - from) / Math.max(1, to - from)))
  const nowT = t(now)
  const nowPoint = at(nowT)

  return (
    <div className="relative w-full max-w-[600px] mx-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto block overflow-visible"
        role="img"
        aria-label={`The day so far: ${Math.round(nowT * 100)} per cent elapsed`}
      >
        <defs>
          {/* Night into light: the part of the day already spent warms as it
              approaches now, which is the only place the two accents meet. */}
          <linearGradient id={`spent-${uid}`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--accent-2)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="1" />
          </linearGradient>
          <radialGradient id={`glow-${uid}`}>
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* The day itself, as one unspent bar. */}
        <path d={arcPath(0, 1)} fill="none" stroke="var(--wait)" strokeWidth="9" strokeLinecap="round" />

        {/* The day so far, warming as it approaches now. */}
        <path
          d={arcPath(0, Math.max(0.004, nowT))}
          fill="none"
          stroke={`url(#spent-${uid})`}
          strokeWidth="9"
          strokeLinecap="round"
          opacity="0.62"
        />

        {/* The five windows, laid on the bar and coloured by what happened in
            them. Dhuhr, Asr, Maghrib and Isha run back to back, so each band is
            inset at both ends — without the gap they merge into one long sweep
            and the arc reads as empty. */}
        {prayers.map((p) => {
          const raw0 = t(p.start)
          // Isha runs past midnight; carry a wrapped close rather than letting
          // it fold back to the start of the arc.
          const raw1 = t(p.end > p.start ? p.end : p.end + 86_400_000)
          const gap = Math.min(GAP, (raw1 - raw0) / 3)
          const start = raw0 + gap
          const end = Math.max(start + 0.004, raw1 - gap)
          return (
            <path
              key={p.prayer}
              d={arcPath(start, end)}
              fill="none"
              stroke={STATE_COLOR[p.state]}
              strokeWidth="9"
              strokeLinecap="round"
            >
              <title>{`${PRAYER_LABELS[p.prayer]} ${formatClock(p.start, tz)} – ${formatClock(p.end, tz)}`}</title>
            </path>
          )
        })}

        {/* Now. A glow, a breathing halo, and the marker itself. */}
        <circle cx={nowPoint.x} cy={nowPoint.y} r="26" fill={`url(#glow-${uid})`} />
        <circle
          cx={nowPoint.x}
          cy={nowPoint.y}
          r="6"
          fill="var(--accent)"
          className="breathe"
          style={{ transformOrigin: `${nowPoint.x}px ${nowPoint.y}px` }}
        />
        <circle
          cx={nowPoint.x}
          cy={nowPoint.y}
          r="5"
          fill="var(--accent)"
          stroke="var(--panel)"
          strokeWidth="2.5"
        />
      </svg>

      {/* The countdown lives in the bowl, framed by the arc that explains it. */}
      <div className="absolute inset-x-0 bottom-0 h-[74%] flex flex-col items-center justify-center px-6">
        {children}
      </div>
    </div>
  )
}

/**
 * A prayer's state as a mark, without being a control itself.
 *
 * It mirrors the checklist's CheckBox, but a button cannot legally nest inside
 * a button and the whole cell below is the hit target — so this is a span that
 * only ever looks the part.
 */
function PrayerMark({ state }: { state: PrayerStatus['state'] }): React.JSX.Element {
  const styles: Record<PrayerStatus['state'], string> = {
    done: 'bg-done border-done',
    late: 'bg-transparent border-late',
    open: 'bg-transparent border-accent',
    missed: 'bg-transparent border-missed',
    upcoming: 'bg-transparent border-line-strong'
  }
  const tick = (color: string): React.JSX.Element => (
    <svg viewBox="0 0 20 20" className="w-full h-full" aria-hidden="true">
      <path
        d="M5 10.4l3.3 3.3L15 6.6"
        fill="none"
        stroke={color}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          strokeDasharray: 20,
          strokeDashoffset: 20,
          animation: 'draw .3s cubic-bezier(.22,1,.36,1) forwards'
        }}
      />
    </svg>
  )
  return (
    <span
      className={`shrink-0 w-[17px] h-[17px] rounded-md border-[1.5px] grid place-items-center
        transition-colors ${styles[state]}`}
      aria-hidden="true"
    >
      {state === 'done' && tick('var(--accent-ink)')}
      {state === 'late' && tick('var(--late)')}
    </span>
  )
}

/**
 * The five names, their opening times, and where a prayer gets checked off.
 *
 * They are not positioned by time: Maghrib and Isha sit close enough together
 * that time-positioned text would collide. The arc above carries the position;
 * this row carries the reading — and the tap.
 *
 * A cell is live while its window is open, and again for as long as the prayer
 * can still be made up. Outside those it is a plain readout, because there is
 * nothing honest to record.
 */
export function PrayerRow({
  prayers,
  settings,
  subject,
  now,
  onToggle
}: {
  prayers: PrayerStatus[]
  settings: Settings
  subject: PrayerStatus | null
  now: number
  /** Omitted on read-only days. */
  onToggle?: (p: PrayerStatus) => void
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-5 gap-1">
      {prayers.map((s) => {
        const label = PRAYER_LABELS[s.prayer]
        const isSubject = subject?.prayer === s.prayer
        const prayed = s.state === 'done' || s.state === 'late'
        const live = onToggle != null && ((now >= s.start && now < s.end) || s.canMakeUp)
        const color =
          s.state === 'done'
            ? 'text-done'
            : s.state === 'late'
              ? 'text-late'
              : s.state === 'missed'
                ? 'text-missed'
                : s.state === 'open'
                  ? 'text-accent'
                  : 'text-dim'

        const title = !live
          ? `${label} ${formatClock(s.start, settings.timezone)} – ${formatClock(s.end, settings.timezone)}`
          : prayed
            ? `Undo ${label}`
            : s.state === 'missed'
              ? `Record ${label} as prayed`
              : `Mark ${label} prayed`

        return (
          <button
            key={s.prayer}
            type="button"
            disabled={!live}
            title={title}
            aria-label={title}
            onClick={live && onToggle ? () => onToggle(s) : undefined}
            className={`flex flex-col items-center gap-1 py-2.5 rounded-lg
              border border-transparent transition-colors
              ${live ? 'cursor-pointer hover:bg-panel-2 hover:border-line' : 'cursor-default'}
              ${isSubject ? 'bg-panel-2' : ''}`}
          >
            {/* Five columns leave ~56px each on a phone — not enough for an
                icon beside a word like "Maghrib". Stacking the mark above
                the label there gives the label the column to itself. */}
            <span className="flex flex-col items-center gap-0.5 md:flex-row md:gap-1.5">
              <PrayerMark state={s.state} />
              <span className={`text-[11.5px] max-md:text-[13px] font-semibold ${color}`}>{label}</span>
            </span>
            <span className={`num text-[12px] max-md:text-[13px] ${isSubject ? 'text-fg' : 'text-faint'}`}>
              {formatClock(s.start, settings.timezone)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
