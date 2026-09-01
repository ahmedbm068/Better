/**
 * Charts, drawn as plain SVG.
 *
 * No charting library: these are simple enough to draw exactly, and hand-drawn
 * axes keep the dense, instrument-like feel the rest of the app has.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Tracks a container's width so charts can be drawn at real pixel sizes. */
export function useMeasure<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      setWidth(Math.max(0, Math.floor(w)))
    })
    observer.observe(el)
    setWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [])

  return [ref, width]
}

const AXIS = 'var(--line)'
const TEXT = 'var(--text3)'

function Axes({
  x,
  y,
  w,
  h,
  ticks
}: {
  x: number
  y: number
  w: number
  h: number
  ticks: Array<{ at: number; label: string }>
}): React.JSX.Element {
  return (
    <g>
      {ticks.map((t) => (
        <g key={`${t.at}-${t.label}`}>
          <line x1={x} x2={x + w} y1={t.at} y2={t.at} stroke={AXIS} strokeDasharray="2 3" />
          <text x={x - 6} y={t.at + 3} textAnchor="end" fill={TEXT} fontSize={9} className="num">
            {t.label}
          </text>
        </g>
      ))}
      <line x1={x} x2={x + w} y1={y + h} y2={y + h} stroke={AXIS} />
    </g>
  )
}

export interface Point {
  label: string
  value: number | null
}

/** A trend line with an optional filled area. Null values break the line. */
export function LineChart({
  points,
  height = 140,
  min = 0,
  max = 100,
  yTicks = [0, 50, 100],
  formatY = (v: number) => String(v),
  color = 'var(--accent)',
  area = true,
  xLabels = 6
}: {
  points: Point[]
  height?: number
  min?: number
  max?: number
  yTicks?: number[]
  formatY?: (v: number) => string
  color?: string
  area?: boolean
  xLabels?: number
}): React.JSX.Element {
  const [ref, width] = useMeasure<HTMLDivElement>()
  const padL = 34
  const padR = 8
  const padT = 8
  const padB = 18
  const w = Math.max(10, width - padL - padR)
  const h = height - padT - padB

  const scaleX = (i: number): number =>
    padL + (points.length <= 1 ? w / 2 : (i / (points.length - 1)) * w)
  const scaleY = (v: number): number =>
    padT + h - ((Math.max(min, Math.min(max, v)) - min) / (max - min || 1)) * h

  // Break the path wherever data is missing rather than interpolating over it.
  const segments: string[] = []
  let current: string[] = []
  points.forEach((p, i) => {
    if (p.value == null) {
      if (current.length) segments.push(current.join(' '))
      current = []
      return
    }
    current.push(`${current.length ? 'L' : 'M'}${scaleX(i).toFixed(1)},${scaleY(p.value).toFixed(1)}`)
  })
  if (current.length) segments.push(current.join(' '))

  const firstIdx = points.findIndex((p) => p.value != null)
  const lastIdx = points.length - 1 - [...points].reverse().findIndex((p) => p.value != null)
  const areaPath =
    area && firstIdx >= 0 && segments.length === 1
      ? `${segments[0]} L${scaleX(lastIdx).toFixed(1)},${padT + h} L${scaleX(firstIdx).toFixed(1)},${padT + h} Z`
      : null

  const labelEvery = Math.max(1, Math.ceil(points.length / xLabels))

  return (
    <div ref={ref} className="w-full">
      {width > 0 && (
        <svg width={width} height={height} role="img">
          <Axes
            x={padL}
            y={padT}
            w={w}
            h={h}
            ticks={yTicks.map((t) => ({ at: scaleY(t), label: formatY(t) }))}
          />
          {areaPath && <path d={areaPath} fill={color} opacity={0.12} />}
          {segments.map((d, i) => (
            <path key={i} d={d} fill="none" stroke={color} strokeWidth={1.5} />
          ))}
          {points.map((p, i) =>
            p.value == null ? null : (
              <circle key={i} cx={scaleX(i)} cy={scaleY(p.value)} r={1.6} fill={color} opacity={0.9}>
                <title>{`${p.label}: ${formatY(p.value)}`}</title>
              </circle>
            )
          )}
          {points.map((p, i) =>
            i % labelEvery === 0 ? (
              <text
                key={`l${i}`}
                x={scaleX(i)}
                y={height - 5}
                textAnchor="middle"
                fill={TEXT}
                fontSize={9}
                className="num"
              >
                {p.label}
              </text>
            ) : null
          )}
        </svg>
      )}
    </div>
  )
}

export interface Bar {
  label: string
  value: number
  /** Optional emphasis, e.g. a night that hit its target. */
  highlight?: boolean
  title?: string
}

export function BarChart({
  bars,
  height = 140,
  max,
  formatY = (v: number) => String(v),
  yTicks = 3,
  color = 'var(--accent)',
  highlightColor = 'var(--done)',
  xLabels = 8,
  overlay
}: {
  bars: Bar[]
  height?: number
  max?: number
  formatY?: (v: number) => string
  yTicks?: number
  color?: string
  highlightColor?: string
  xLabels?: number
  /** Extra marks drawn in the same plot area, e.g. a bedtime scatter. */
  overlay?: (helpers: {
    scaleX: (i: number) => number
    plotTop: number
    plotHeight: number
    barWidth: number
  }) => ReactNode
}): React.JSX.Element {
  const [ref, width] = useMeasure<HTMLDivElement>()
  const padL = 38
  const padR = 8
  const padT = 8
  const padB = 18
  const w = Math.max(10, width - padL - padR)
  const h = height - padT - padB
  const top = max ?? Math.max(1, ...bars.map((b) => b.value))

  const slot = bars.length ? w / bars.length : w
  const barWidth = Math.max(2, Math.min(22, slot * 0.62))
  const scaleX = (i: number): number => padL + slot * i + slot / 2
  const scaleY = (v: number): number => padT + h - (Math.max(0, v) / (top || 1)) * h

  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => (top / yTicks) * i)
  const labelEvery = Math.max(1, Math.ceil(bars.length / xLabels))

  return (
    <div ref={ref} className="w-full">
      {width > 0 && (
        <svg width={width} height={height} role="img">
          <Axes
            x={padL}
            y={padT}
            w={w}
            h={h}
            ticks={ticks.map((t) => ({ at: scaleY(t), label: formatY(t) }))}
          />
          {bars.map((b, i) => {
            const y = scaleY(b.value)
            return (
              <rect
                key={`${b.label}-${i}`}
                x={scaleX(i) - barWidth / 2}
                y={y}
                width={barWidth}
                height={Math.max(b.value > 0 ? 1 : 0, padT + h - y)}
                rx={1}
                fill={b.highlight ? highlightColor : color}
                opacity={b.value > 0 ? 0.85 : 0}
              >
                <title>{b.title ?? `${b.label}: ${formatY(b.value)}`}</title>
              </rect>
            )
          })}
          {overlay?.({ scaleX, plotTop: padT, plotHeight: h, barWidth })}
          {bars.map((b, i) =>
            i % labelEvery === 0 ? (
              <text
                key={`l${i}`}
                x={scaleX(i)}
                y={height - 5}
                textAnchor="middle"
                fill={TEXT}
                fontSize={9}
                className="num"
              >
                {b.label}
              </text>
            ) : null
          )}
        </svg>
      )}
    </div>
  )
}

/** Horizontal bars, for ranked totals like hours per project. */
export function HBars({
  rows,
  formatValue
}: {
  rows: Array<{ label: string; value: number }>
  formatValue: (v: number) => string
}): React.JSX.Element {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-center">
          <div className="min-w-0">
            <div className="flex justify-between gap-2 mb-1">
              <span className="truncate text-[12px]">{r.label}</span>
            </div>
            <div className="h-1.5 bg-wait rounded-full overflow-hidden">
              <div
                className="h-full bg-accent"
                style={{ width: `${(r.value / max) * 100}%` }}
              />
            </div>
          </div>
          <span className="num text-[12px] text-dim tabular-nums">{formatValue(r.value)}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * A GitHub-style contribution grid. Columns are weeks, rows are weekdays, so
 * the shape of a month reads at a glance.
 */
export function Heatmap({
  cells,
  weekdayOf
}: {
  cells: Array<{ date: string; value: number | null; inFuture: boolean }>
  weekdayOf: (date: string) => number
}): React.JSX.Element {
  if (cells.length === 0) return <div className="text-[12px] text-faint">No history yet.</div>

  // Pad the first column so each row is a fixed weekday.
  const leading = weekdayOf(cells[0].date)
  const padded = [...Array.from({ length: leading }, () => null), ...cells]
  const weeks: Array<Array<(typeof cells)[number] | null>> = []
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7))

  const shade = (value: number | null, inFuture: boolean): string => {
    if (inFuture) return 'transparent'
    if (value == null) return 'var(--wait)'
    if (value === 0) return 'var(--wait)'
    if (value < 0.34) return 'color-mix(in srgb, var(--accent) 28%, var(--wait))'
    if (value < 0.67) return 'color-mix(in srgb, var(--accent) 55%, var(--wait))'
    if (value < 1) return 'color-mix(in srgb, var(--accent) 78%, var(--wait))'
    return 'var(--accent)'
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-[3px]">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {Array.from({ length: 7 }, (_, di) => {
              const cell = week[di]
              if (!cell) return <div key={di} className="w-[11px] h-[11px]" />
              return (
                <div
                  key={di}
                  className="w-[11px] h-[11px] "
                  style={{
                    background: shade(cell.value, cell.inFuture),
                    border: cell.inFuture ? '1px dashed var(--line)' : 'none'
                  }}
                  title={`${cell.date}: ${
                    cell.inFuture
                      ? 'upcoming'
                      : cell.value == null
                        ? 'nothing scheduled'
                        : `${Math.round(cell.value * 100)}%`
                  }`}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

/** A tiny inline trend, no axes. */
export function Sparkline({
  values,
  width = 90,
  height = 22,
  color = 'var(--accent)'
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
}): React.JSX.Element {
  if (values.length < 2) return <svg width={width} height={height} />
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const d = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (width - 2) + 1
      const y = height - 1 - ((v - min) / (max - min || 1)) * (height - 2)
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={width} height={height} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={1.25} />
    </svg>
  )
}
