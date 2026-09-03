/**
 * The component layer.
 *
 * Soft corners, one real elevation step, and a single accent reserved for the
 * live thing and the primary action. Depth comes from the panel ground plus a
 * hairline top highlight rather than from heavy borders.
 *
 * Motion is functional only: things that appear, rise; things that are checked,
 * draw; things that are running, breathe. Nothing moves for decoration.
 */
import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { IconChevron, IconClose, IconFlame, MarkAllPrayers, MarkSmokeFree } from './icons'

export { MarkAllPrayers, MarkSmokeFree }

const EASE = 'cubic-bezier(.22,1,.36,1)'

/**
 * A card. `live` marks the current or running thing with a tinted ring and a
 * breathing dot beside its title — at most one per screen.
 */
export function Panel({
  title,
  right,
  children,
  className = '',
  bodyClass = '',
  pad = true,
  live = false
}: {
  title?: ReactNode
  right?: ReactNode
  children: ReactNode
  className?: string
  /** Applied to the body, for cards that have to fill a stretched grid cell. */
  bodyClass?: string
  pad?: boolean
  live?: boolean
}): React.JSX.Element {
  return (
    <section
      className={`bg-panel rounded-xl shadow-card border transition-colors
        ${live ? 'border-accent/40' : 'border-line'} ${className}`}
    >
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 px-4 h-11 border-b border-line">
          <span className="label flex items-center gap-2 min-w-0">
            {live && (
              <span className="relative grid place-items-center w-2 h-2 shrink-0">
                <span className="absolute w-2 h-2 rounded-full bg-accent breathe" />
                <span className="w-1.25 h-1.25 rounded-full bg-accent" />
              </span>
            )}
            <span className="truncate">{title}</span>
          </span>
          {right}
        </header>
      )}
      <div className={`${pad ? 'p-4' : ''} ${bodyClass}`}>{children}</div>
    </section>
  )
}

/** A section kicker inside a panel — related things get a gap, unrelated a rule. */
export function Kicker({
  children,
  right
}: {
  children: ReactNode
  right?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="kicker">{children}</span>
      {right}
    </div>
  )
}

export function Button({
  children,
  onClick,
  variant = 'default',
  size = 'md',
  disabled,
  title,
  type = 'button',
  className = ''
}: {
  children: ReactNode
  onClick?: () => void
  /** `default` is the secondary treatment; `ghost` is the micro treatment. */
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  title?: string
  type?: 'button' | 'submit'
  className?: string
}): React.JSX.Element {
  const variants: Record<string, string> = {
    primary:
      'bg-accent border-accent text-accent-ink font-semibold shadow-card ' +
      'hover:brightness-108 hover:-translate-y-px active:translate-y-0',
    default:
      'bg-panel-2 border-line text-fg hover:border-line-strong hover:bg-panel ' +
      'hover:-translate-y-px active:translate-y-0',
    ghost: 'bg-transparent border-transparent text-faint hover:text-fg hover:bg-panel-2',
    danger:
      'bg-transparent border-transparent text-faint hover:text-missed hover:bg-missed-ghost'
  }
  const sizes: Record<string, string> = {
    sm: 'h-7 px-2.5 text-[11.5px] rounded-md gap-1.5',
    md: 'h-9 px-3.5 text-[13px] rounded-md gap-2',
    lg: 'h-11 px-5 text-[14px] rounded-lg gap-2'
  }
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{ transition: `all .18s ${EASE}` }}
      className={`inline-flex items-center justify-center border cursor-pointer whitespace-nowrap
        disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0
        active:scale-[0.98] ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </button>
  )
}

/** The stepper pair used to page through months and weeks. */
export function Stepper({
  onPrev,
  onNext,
  prevLabel = 'Previous',
  nextLabel = 'Next',
  disableNext
}: {
  onPrev: () => void
  onNext: () => void
  prevLabel?: string
  nextLabel?: string
  disableNext?: boolean
}): React.JSX.Element {
  const base =
    'w-7 h-7 grid place-items-center rounded-md border border-line bg-panel-2 text-dim ' +
    'hover:text-fg hover:border-line-strong active:scale-95 transition-all ' +
    'disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer'
  return (
    <span className="flex gap-1.5">
      <button type="button" aria-label={prevLabel} title={prevLabel} onClick={onPrev} className={base}>
        <IconChevron dir="left" size={15} />
      </button>
      <button
        type="button"
        aria-label={nextLabel}
        title={nextLabel}
        onClick={onNext}
        disabled={disableNext}
        className={base}
      >
        <IconChevron dir="right" size={15} />
      </button>
    </span>
  )
}

export type CheckState = 'done' | 'late' | 'open' | 'missed' | 'grace' | 'upcoming'

/**
 * The checkbox.
 *
 * A grace day is never a checkmark and never green — it is its own state, so it
 * cannot be mistaken for having done the thing.
 *
 * A late prayer does get a checkmark, because it was prayed, but a hollow one
 * in its own colour: the shape says done, the fill says not on time.
 */
export function CheckBox({
  state,
  onToggle,
  disabled,
  label
}: {
  state: CheckState
  onToggle?: () => void
  disabled?: boolean
  label?: string
}): React.JSX.Element {
  const styles: Record<CheckState, string> = {
    done: 'bg-done border-done',
    late: 'bg-transparent border-late',
    open: 'bg-transparent border-accent',
    missed: 'bg-transparent border-missed',
    grace: 'bg-transparent border-grace',
    upcoming: 'bg-transparent border-line-strong'
  }
  const inert = disabled || !onToggle
  // Redrawn on every state change, so the tick animates in each time it lands.
  const tick = (color: string): React.JSX.Element => (
    <svg viewBox="0 0 20 20" className="w-full h-full" aria-hidden="true">
      <path
        d="M5 10.4l3.3 3.3L15 6.6"
        fill="none"
        stroke={color}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          strokeDasharray: 20,
          strokeDashoffset: 20,
          animation: `draw .3s ${EASE} forwards`
        }}
      />
    </svg>
  )
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'done' || state === 'late'}
      aria-label={label}
      disabled={inert}
      onClick={onToggle}
      style={{ transition: `all .18s ${EASE}` }}
      className={`shrink-0 w-5 h-5 rounded-md border-[1.5px] grid place-items-center
        ${styles[state]}
        ${inert ? 'cursor-default' : 'cursor-pointer hover:scale-110 active:scale-90'}`}
    >
      {state === 'done' && tick('var(--accent-ink)')}
      {state === 'late' && tick('var(--late)')}
      {state === 'grace' && (
        <span className="num text-[10px] font-bold text-grace leading-none">G</span>
      )}
    </button>
  )
}

/** A full checklist row: box, name, meta, and whatever the row carries right. */
export function CheckRow({
  state,
  onToggle,
  label,
  sub,
  right,
  onLabelClick,
  dim = false
}: {
  state: CheckState
  onToggle?: () => void
  label: ReactNode
  sub?: ReactNode
  right?: ReactNode
  onLabelClick?: () => void
  dim?: boolean
}): React.JSX.Element {
  return (
    <div
      className={`group flex items-center gap-3 px-3 py-2 min-h-11 rounded-lg
        hover:bg-panel-2 transition-colors ${dim ? 'opacity-50' : ''}`}
    >
      <CheckBox
        state={state}
        onToggle={onToggle}
        label={typeof label === 'string' ? label : undefined}
      />
      <div className="min-w-0 flex-1">
        {onLabelClick ? (
          <button
            type="button"
            onClick={onLabelClick}
            className="text-left max-md:line-clamp-2 md:truncate w-full cursor-pointer hover:text-accent transition-colors"
          >
            {label}
          </button>
        ) : (
          <div
            className={`max-md:line-clamp-2 md:truncate transition-colors ${
              state === 'done' || state === 'late' ? 'text-dim' : ''
            }`}
          >
            {label}
          </div>
        )}
        {sub && <div className="quiet truncate mt-0.5">{sub}</div>}
      </div>
      {right}
    </div>
  )
}

/**
 * A stat tile. A tile with no data shows an em dash, never a zero — an untracked
 * day is not a failure and must not look like one.
 */
export function StatTile({
  label,
  value,
  unit,
  sub,
  bars,
  tone = 'default'
}: {
  label: string
  /** `null` renders the em dash. */
  value: string | number | null
  unit?: string
  sub?: ReactNode
  /** Optional 7-bar week shape, values 0..1. */
  bars?: number[]
  tone?: 'default' | 'accent' | 'done' | 'missed'
}): React.JSX.Element {
  const tones: Record<string, string> = {
    default: 'text-fg',
    accent: 'text-accent',
    done: 'text-done',
    missed: 'text-missed'
  }
  const empty = value === null || value === undefined
  return (
    <div className="flex-1 min-w-0 px-4 py-3.5 bg-panel">
      <div className="micro mb-2">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span
          className={`num text-[30px] leading-none font-medium tracking-[-0.02em]
            ${empty ? 'text-faint' : tones[tone]}`}
        >
          {empty ? '—' : value}
        </span>
        {unit && !empty && <span className="text-[11.5px] text-faint">{unit}</span>}
      </div>
      {bars && <MiniBars values={bars} className="mt-2.5" />}
      {sub && <div className="quiet mt-2 truncate">{sub}</div>}
    </div>
  )
}

/** The week shape. Every bar sits on a `--wait` ground, and grows on arrival. */
export function MiniBars({
  values,
  className = '',
  height = 18,
  tone = 'accent'
}: {
  values: number[]
  className?: string
  height?: number
  tone?: 'accent' | 'dim'
}): React.JSX.Element {
  return (
    <div className={`flex items-end gap-0.75 ${className}`} style={{ height }} aria-hidden="true">
      {values.map((v, i) => (
        <div key={i} className="flex-1 bg-wait rounded-[2px] relative" style={{ height }}>
          <div
            className={`absolute bottom-0 left-0 right-0 rounded-[2px]
              ${tone === 'accent' ? 'bg-accent' : 'bg-dim'}`}
            style={{
              height: `${Math.max(0, Math.min(1, v)) * 100}%`,
              transition: `height .5s ${EASE}`,
              transitionDelay: `${i * 18}ms`
            }}
          />
        </div>
      ))}
    </div>
  )
}

/**
 * A progress ring. Used where a number needs a shape around it — the day score,
 * mainly — because a bare figure out of 100 reads as a grade and a ring does not.
 */
export function Ring({
  value,
  max = 100,
  size = 76,
  stroke = 6,
  tone = 'accent',
  children
}: {
  value: number
  max?: number
  size?: number
  stroke?: number
  tone?: 'accent' | 'done' | 'missed'
  children?: ReactNode
}): React.JSX.Element {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  const colors: Record<string, string> = {
    accent: 'var(--accent)',
    done: 'var(--done)',
    missed: 'var(--missed)'
  }
  return (
    <div className="relative shrink-0 grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--wait)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={colors[tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: `stroke-dashoffset .9s ${EASE}` }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  )
}

/** A small round-cornered tag. Carries one fact and no more. */
export function Chip({
  children,
  tone = 'default',
  className = '',
  title
}: {
  children: ReactNode
  tone?: 'default' | 'accent' | 'done' | 'missed' | 'grace'
  className?: string
  title?: string
}): React.JSX.Element {
  const tones: Record<string, string> = {
    default: 'bg-panel-2 text-dim',
    accent: 'bg-accent-ghost text-accent',
    done: 'bg-done-ghost text-done',
    missed: 'bg-missed-ghost text-missed',
    grace: 'bg-grace-ghost text-grace'
  }
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 h-5.5 px-2 rounded-full
        text-[11.5px] font-medium whitespace-nowrap ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

/**
 * Current streak with its all-time record. A broken streak still shows the
 * record — the evidence is never erased.
 */
export function StreakBadge({
  current,
  record
}: {
  current: number
  record: number
}): React.JSX.Element {
  const live = current > 0
  return (
    <span
      className={`inline-flex items-center gap-1 h-5.5 pl-1.5 pr-2 rounded-full shrink-0
        text-[11.5px] ${live ? 'bg-accent-ghost text-accent' : 'bg-panel-2 text-faint'}`}
      title={`Current streak ${current} · all-time record ${record}`}
    >
      <IconFlame size={12} />
      <span className="num font-medium">
        {current}
        <span className="opacity-55">/{record}</span>
      </span>
    </span>
  )
}

export interface StripDay {
  date: string
  applies?: boolean
  done: boolean
  grace?: boolean
  missed?: boolean
  tracked?: boolean
}

/**
 * The day strip. Done is filled; everything else is hollow and colour-coded, so
 * a run of completions reads as one solid block.
 */
export function DayStrip({
  days,
  cell = 8,
  tall
}: {
  days: StripDay[]
  cell?: number
  /** The 30-day form uses 5×12 cells instead of squares. */
  tall?: boolean
}): React.JSX.Element {
  const w = tall ? 5 : cell
  const h = tall ? 12 : cell
  return (
    <span className="inline-flex gap-0.75" aria-hidden="true">
      {days.map((d) => {
        const untracked = d.tracked === false || d.applies === false
        const look = d.done
          ? 'border-done bg-done'
          : d.grace
            ? 'border-grace bg-grace-ghost'
            : untracked
              ? 'border-line opacity-60'
              : d.missed
                ? 'border-missed bg-missed-ghost'
                : 'border-line-strong'
        return (
          <span
            key={d.date}
            title={`${d.date}: ${
              untracked ? 'not scheduled' : d.done ? 'done' : d.grace ? 'grace day' : 'not done'
            }`}
            className={`border rounded-[2px] ${look}`}
            style={{ width: w, height: h }}
          />
        )
      })}
    </span>
  )
}

export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <label className="block">
      <span className="micro block mb-1.5">{label}</span>
      {children}
      {hint && <span className="block mt-1.5 quiet">{hint}</span>}
    </label>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-line last:border-b-0">
      <div className="min-w-0">
        <div>{label}</div>
        {hint && <div className="quiet mt-0.5">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        style={{ transition: `all .2s ${EASE}` }}
        className={`shrink-0 w-10 h-5.5 rounded-full border cursor-pointer relative mt-0.5
          ${checked ? 'bg-accent border-accent' : 'bg-panel-2 border-line-strong'}`}
      >
        <span
          style={{ transition: `all .22s ${EASE}` }}
          className={`absolute top-0.75 w-3.5 h-3.5 rounded-full
            ${checked ? 'left-5.25 bg-accent-ink' : 'left-0.75 bg-faint'}`}
        />
      </button>
    </div>
  )
}

/**
 * A segmented picker: two to four mutually exclusive choices, all visible.
 *
 * A toggle can only ask a yes/no question. Where the answer is one of a few —
 * the theme, a stats range — showing every option costs one row and saves the
 * reader from having to remember what the alternatives were.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T
  options: Array<{ value: T; label: ReactNode; title?: string }>
  onChange: (value: T) => void
  label?: string
}): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 p-1 rounded-lg bg-panel-2">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            style={{ transition: `all .18s ${EASE}` }}
            className={`flex-1 h-8 px-3 rounded-md text-[12.5px] cursor-pointer
              inline-flex items-center justify-center gap-1.5 whitespace-nowrap
              ${
                active
                  ? 'bg-panel text-fg font-medium shadow-card'
                  : 'text-dim hover:text-fg'
              }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** A calm, factual message. Guard refusals land here — never a red shame box. */
export function Note({
  children,
  tone = 'info'
}: {
  children: ReactNode
  tone?: 'info' | 'warn'
}): React.JSX.Element {
  return (
    <div
      className={`text-[13px] px-3.5 py-2.5 rounded-lg border pop-in ${
        tone === 'warn'
          ? 'border-missed/35 bg-missed-ghost text-fg'
          : 'border-line bg-panel-2 text-dim'
      }`}
    >
      {children}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="quiet py-7 text-center">{children}</div>
}

/** A thin meter. Every bar gets a `--wait` ground so the remainder is visible. */
export function Meter({
  value,
  max = 100,
  tone = 'accent',
  height = 5
}: {
  value: number
  max?: number
  tone?: 'accent' | 'done' | 'missed' | 'dim'
  height?: number
}): React.JSX.Element {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  const colors: Record<string, string> = {
    accent: 'bg-accent',
    done: 'bg-done',
    missed: 'bg-missed',
    dim: 'bg-dim'
  }
  return (
    <div className="w-full bg-wait rounded-full overflow-hidden" style={{ height }}>
      <div
        className={`h-full rounded-full ${colors[tone]}`}
        style={{ width: `${pct}%`, transition: `width .7s ${EASE}` }}
      />
    </div>
  )
}

export function Modal({
  open,
  title,
  onClose,
  children,
  width = 'max-w-md'
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  width?: string
}): React.JSX.Element | null {
  const bodyRef = useRef<HTMLDivElement>(null)

  // Held in a ref so the Escape listener does not depend on a prop that callers
  // pass as an inline arrow — otherwise this effect re-runs on every render.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  /*
   * Focus the first field, once per opening.
   *
   * Two things have to hold or typing breaks. It must depend on `open` alone —
   * re-running it on each render would drag the caret back mid-word. And it must
   * search the body only: the header's close button comes first in document
   * order, so a dialog-wide query would focus the ✕ instead of the input.
   */
  useEffect(() => {
    if (!open) return
    bodyRef.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus()
  }, [open])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6 fade-in
        backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${width} bg-panel border border-line-strong rounded-xl shadow-pop pop-in`}
      >
        <header className="flex items-center justify-between px-4 h-12 border-b border-line">
          <span className="label">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-faint hover:text-fg hover:bg-panel-2 rounded-md w-7 h-7
              grid place-items-center cursor-pointer transition-colors"
          >
            <IconClose size={15} />
          </button>
        </header>
        <div className="p-4" ref={bodyRef}>
          {children}
        </div>
      </div>
    </div>
  )
}
