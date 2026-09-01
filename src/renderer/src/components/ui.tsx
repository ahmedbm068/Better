/**
 * The component layer, built to the design handoff.
 *
 * Zero radius, no shadows, no gradients — depth is borders plus the
 * bg / panel / panel2 ground steps. One accent, reserved for the live thing and
 * the primary action. Nothing renders below 10px.
 */
import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'

/**
 * A panel. `live` gives it the 2px accent top rule that marks the current or
 * running thing — at most one per screen.
 */
export function Panel({
  title,
  right,
  children,
  className = '',
  pad = true,
  live = false
}: {
  title?: ReactNode
  right?: ReactNode
  children: ReactNode
  className?: string
  pad?: boolean
  live?: boolean
}): React.JSX.Element {
  return (
    <section
      className={`bg-panel border border-line ${live ? 'border-t-2 border-t-accent' : ''} ${className}`}
    >
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 px-4 pt-3 pb-[11px] border-b-2 border-line-strong">
          <span className="label">{title}</span>
          {right}
        </header>
      )}
      <div className={pad ? 'p-[18px]' : ''}>{children}</div>
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
      'bg-accent border-accent text-accent-ink font-bold tracking-[0.15em] uppercase hover:opacity-88',
    default: 'bg-transparent border-line-strong text-dim hover:border-accent hover:text-fg',
    ghost:
      'bg-transparent border-transparent text-faint uppercase tracking-[0.1em] font-mono hover:text-fg',
    danger:
      'bg-transparent border-transparent text-faint uppercase tracking-[0.1em] font-mono hover:text-missed'
  }
  const sizes: Record<string, string> = {
    sm: 'h-[23px] px-2 text-[10px]',
    md: 'h-8 px-3 text-[12px]',
    lg: 'h-[42px] px-4 text-[13px]'
  }
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-start gap-2 border transition-colors
        disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap
        ${variants[variant]} ${sizes[size]} ${className}`}
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
    'w-[26px] h-6 grid place-items-center border border-line-strong text-dim font-mono ' +
    'hover:border-accent hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer'
  return (
    <span className="flex gap-1">
      <button type="button" aria-label={prevLabel} title={prevLabel} onClick={onPrev} className={base}>
        ‹
      </button>
      <button
        type="button"
        aria-label={nextLabel}
        title={nextLabel}
        onClick={onNext}
        disabled={disableNext}
        className={base}
      >
        ›
      </button>
    </span>
  )
}

export type CheckState = 'done' | 'open' | 'missed' | 'grace' | 'upcoming'

/**
 * The checkbox.
 *
 * A grace day is never a checkmark and never green — it is its own state, so it
 * cannot be mistaken for having done the thing.
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
    open: 'bg-transparent border-accent',
    missed: 'bg-transparent border-missed',
    grace: 'bg-transparent border-grace',
    upcoming: 'bg-transparent border-line-strong'
  }
  const inert = disabled || !onToggle
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'done'}
      aria-label={label}
      disabled={inert}
      onClick={onToggle}
      className={`shrink-0 w-4 h-4 border-[1.5px] grid place-items-center transition-colors
        ${styles[state]} ${inert ? 'cursor-default' : 'cursor-pointer'}`}
    >
      {state === 'done' && (
        <svg viewBox="0 0 16 16" className="w-full h-full text-panel" aria-hidden="true">
          <path
            d="M3.5 8.2l3 3L12.5 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="square"
          />
        </svg>
      )}
      {state === 'grace' && (
        <span className="num text-[9px] font-bold text-grace leading-none">G</span>
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
      className={`flex items-center gap-3 px-4 min-h-8 border-b border-line last:border-b-0
        hover:bg-panel-2 transition-colors ${dim ? 'opacity-55' : ''}`}
    >
      <CheckBox
        state={state}
        onToggle={onToggle}
        label={typeof label === 'string' ? label : undefined}
      />
      <div className="min-w-0 flex-1 py-1.5">
        {onLabelClick ? (
          <button
            type="button"
            onClick={onLabelClick}
            className="text-left truncate w-full cursor-pointer hover:text-accent transition-colors"
          >
            {label}
          </button>
        ) : (
          <div className={`truncate ${state === 'done' ? 'text-dim' : ''}`}>{label}</div>
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
    <div className="flex-1 min-w-0 border-l border-line px-[18px] pt-[13px] pb-[15px] first:border-l-0">
      <div className="micro mb-2">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span
          className={`num text-[31px] leading-none font-medium ${empty ? 'text-faint' : tones[tone]}`}
        >
          {empty ? '—' : value}
        </span>
        {unit && !empty && <span className="text-[11px] text-faint">{unit}</span>}
      </div>
      {bars && <MiniBars values={bars} className="mt-2.5" />}
      {sub && <div className="quiet mt-2 truncate">{sub}</div>}
    </div>
  )
}

/** The 7-bar week shape. Every bar sits on a `--wait` ground. */
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
    <div className={`flex items-end gap-[3px] ${className}`} style={{ height }} aria-hidden="true">
      {values.map((v, i) => (
        <div key={i} className="flex-1 bg-wait relative" style={{ height }}>
          <div
            className={`absolute bottom-0 left-0 right-0 ${tone === 'accent' ? 'bg-accent' : 'bg-dim'}`}
            style={{ height: `${Math.max(0, Math.min(1, v)) * 100}%` }}
          />
        </div>
      ))}
    </div>
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
  return (
    <span
      className="num text-[12px] shrink-0 w-16 text-right"
      title={`Current streak ${current} · all-time record ${record}`}
    >
      <span className={current > 0 ? 'text-fg' : 'text-faint'}>{current}</span>
      <span className="text-faint"> / {record}</span>
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
 * a run of completions reads as a solid block.
 */
export function DayStrip({
  days,
  cell = 7,
  tall
}: {
  days: StripDay[]
  cell?: number
  /** The 30-day form uses 5×11 cells instead of squares. */
  tall?: boolean
}): React.JSX.Element {
  const w = tall ? 5 : cell
  const h = tall ? 11 : cell
  return (
    <span className="inline-flex gap-[3px]" aria-hidden="true">
      {days.map((d) => {
        const untracked = d.tracked === false || d.applies === false
        const border = d.done
          ? 'border-done bg-done'
          : d.grace
            ? 'border-grace'
            : untracked
              ? 'border-line-strong opacity-50'
              : d.missed
                ? 'border-missed'
                : 'border-line-strong'
        return (
          <span
            key={d.date}
            title={`${d.date}: ${
              untracked ? 'not scheduled' : d.done ? 'done' : d.grace ? 'grace day' : 'not done'
            }`}
            className={`border ${border}`}
            style={{ width: w, height: h }}
          />
        )
      })}
    </span>
  )
}

/**
 * The two achievement marks, hand-written at 16px. Four paths total; never an
 * icon font and never an emoji.
 */
export function MarkAllPrayers({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="var(--done)"
      strokeWidth="1.4"
      role="img"
    >
      <title>All five prayers</title>
      <path d="M3 14.5V7.5a5 5 0 0 1 10 0v7" />
      <path d="M1 14.5h14" />
    </svg>
  )
}

export function MarkSmokeFree({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="var(--accent)"
      strokeWidth="1.4"
      role="img"
    >
      <title>Smoke-free</title>
      <path d="M1.5 11h9.5" />
      <path d="M12.6 11h2" />
      <path d="M3 14.5 13.5 4" />
    </svg>
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
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-line last:border-b-0">
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
        className={`shrink-0 w-10 h-5 border transition-colors cursor-pointer relative
          ${checked ? 'bg-accent border-accent' : 'bg-transparent border-line-strong'}`}
      >
        <span
          className={`absolute top-[3px] w-3 h-3 transition-all
            ${checked ? 'left-[23px] bg-accent-ink' : 'left-[3px] bg-faint'}`}
        />
      </button>
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
      className={`text-[12.5px] px-3 py-2 border-l-2 ${
        tone === 'warn'
          ? 'border-missed bg-missed-soft text-fg'
          : 'border-line-strong bg-panel-2 text-dim'
      }`}
    >
      {children}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="quiet py-6 text-center">{children}</div>
}

/** A thin meter. Every bar gets a `--wait` ground so the remainder is visible. */
export function Meter({
  value,
  max = 100,
  tone = 'accent',
  height = 4
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
    <div className="w-full bg-wait" style={{ height }}>
      <div className={`h-full ${colors[tone]}`} style={{ width: `${pct}%` }} />
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
   * order, so a dialog-wide query would focus ✕ instead of the input.
   */
  useEffect(() => {
    if (!open) return
    bodyRef.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus()
  }, [open])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${width} bg-panel border border-line-strong border-t-2 border-t-accent`}
      >
        <header className="flex items-center justify-between px-4 h-11 border-b-2 border-line-strong">
          <span className="label">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-faint hover:text-fg cursor-pointer px-1 font-mono"
          >
            ✕
          </button>
        </header>
        <div className="p-[18px]" ref={bodyRef}>
          {children}
        </div>
      </div>
    </div>
  )
}
