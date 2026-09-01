/**
 * Sleep — last night as the hero, then thirty nights of drift.
 *
 * The chart is two readings on one date axis: bedtime as dots over a tolerance
 * band with the target dashed through it, and duration as bars beneath. Bedtime
 * needs a vertical scale of its own, so its time marks sit in a left gutter and
 * the duration chart is indented to match — one axis, two readings.
 */
import { useEffect, useState } from 'react'
import type { SleepNight } from '@shared/api'
import { parseHHMM } from '@shared/time'
import {
  formatClock,
  formatDateShort,
  formatHoursMinutes,
  plotMinutesToClock
} from '@shared/format'
import { api } from '../lib/api'
import { useAction, useAsync, usePersistedState } from '../lib/hooks'
import { Button, Empty, Note, Panel, StatTile } from '../components/ui'

/** The bedtime axis is anchored at 18:00, so a later night plots higher. */
const anchor18h = (minutes: number): number => (minutes < 18 * 60 ? minutes + 1440 : minutes) - 18 * 60

export default function SleepPage(): React.JSX.Element {
  const [range, setRange] = usePersistedState<number>('sleep.range', 30)
  const { data: settings } = useAsync(() => api.getSettings(), [])
  const { data: today } = useAsync(() => api.currentDate(), [])
  const { data, reload } = useAsync(() => api.getRecentNights(range), [range])
  const action = useAction()

  const [editDate, setEditDate] = useState<string | null>(null)

  if (!data || !settings || !today) return <div className="p-[18px] text-faint">Loading…</div>

  const nights = data.nights
  const summary = data.summary
  const tonight = nights.find((n) => n.date === today) ?? null
  const pending = tonight?.sleepAt != null && tonight?.wakeAt == null

  const run = (fn: () => Promise<unknown>): void => {
    void action.run(fn).then(() => reload())
  }

  const bed = parseHHMM(settings.targetBedtime)
  const bedTargetPlot = anchor18h(bed.hour * 60 + bed.minute)
  const tol = settings.sleepTargetToleranceMin

  return (
    <div className="pb-5">
      <div className="h-11 px-[18px] border-b border-line flex items-center justify-between gap-4 bg-panel">
        <span className="label">Sleep</span>
        <span className="flex items-center gap-2">
          {[14, 30, 90].map((n) => (
            <Button
              key={n}
              size="sm"
              variant={range === n ? 'default' : 'ghost'}
              onClick={() => setRange(n)}
            >
              {n}d
            </Button>
          ))}
        </span>
      </div>

      {action.error && (
        <div className="px-[18px] pt-3">
          <Note tone={action.error.isGuard ? 'info' : 'warn'}>{action.error.message}</Note>
        </div>
      )}

      <div className="px-[18px] pt-4">
        <Panel live={pending} pad={false}>
          <div className="flex flex-col lg:flex-row">
            <div className="px-6 py-6 lg:w-[440px] shrink-0 lg:border-r border-line">
              <div className="micro">Last night</div>
              <div className="flex items-baseline gap-3 mt-2">
                <span className="num text-[22px] text-dim">
                  {formatClock(tonight?.sleepAt, settings.timezone)} →{' '}
                  {formatClock(tonight?.wakeAt, settings.timezone)}
                </span>
              </div>
              <div
                className={`num text-[46px] leading-none font-medium tracking-[-0.02em] mt-2
                  ${tonight?.durationMin == null ? 'text-faint' : tonight.onTarget ? 'text-done' : ''}`}
              >
                {tonight?.durationMin != null ? formatHoursMinutes(tonight.durationMin) : '—'}
              </div>
              <div className="flex gap-6 mt-4">
                <Against
                  label="Bedtime"
                  actual={tonight?.sleepAt}
                  target={settings.targetBedtime}
                  tz={settings.timezone}
                  tol={tol}
                />
                <Against
                  label="Wake"
                  actual={tonight?.wakeAt}
                  target={settings.targetWakeTime}
                  tz={settings.timezone}
                  tol={tol}
                />
              </div>
            </div>

            <div className="flex-1 min-w-0 px-6 py-6">
              <div className="flex gap-2.5">
                <Button
                  variant={pending ? 'default' : 'primary'}
                  onClick={() => run(() => api.goingToSleep())}
                >
                  Going to sleep
                </Button>
                <Button
                  variant={pending ? 'primary' : 'default'}
                  onClick={() => run(() => api.wokeUp())}
                >
                  Woke up
                </Button>
              </div>
              <p className="quiet mt-3">
                {pending
                  ? 'Bedtime recorded. Press “Woke up” in the morning.'
                  : 'A bedtime after midnight belongs to the day before.'}
              </p>

              <div className="mt-5 pt-5 border-t border-line">
                <div className="micro mb-2.5">Correct a night a button missed</div>
                <ManualEdit
                  date={editDate ?? today}
                  tz={settings.timezone}
                  onPickDate={setEditDate}
                  nights={nights}
                  onSaved={reload}
                />
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <div className="px-[18px] pt-2.5">
        <div className="flex border border-line bg-panel">
          <StatTile
            label="Avg duration"
            value={summary.avgDurationMin != null ? formatHoursMinutes(summary.avgDurationMin) : null}
            sub={`Avg / recorded night · ${range}d`}
          />
          <StatTile
            label="Avg bedtime"
            value={summary.avgBedtimePlot != null ? plotMinutesToClock(summary.avgBedtimePlot) : null}
          />
          <StatTile
            label="On target"
            value={summary.nightsRecorded ? summary.nightsOnTarget : null}
            unit={summary.nightsRecorded ? `/ ${summary.nightsRecorded}` : undefined}
          />
          <StatTile
            label="Nights recorded"
            value={summary.nightsRecorded || null}
            unit={`/ ${range}`}
          />
        </div>
      </div>

      <div className="px-[18px] pt-2.5">
        <Panel title="Bedtime drift and duration" right={<span className="micro">{range} nights</span>}>
          {nights.every((n) => n.durationMin == null) ? (
            <Empty>No nights recorded yet.</Empty>
          ) : (
            <DriftChart
              nights={nights}
              bedTargetPlot={bedTargetPlot}
              tol={tol}
              onPick={setEditDate}
            />
          )}
        </Panel>
      </div>

      <div className="px-[18px] pt-2.5">
        <Panel title="Nights" pad={false}>
          <ul>
            {[...nights].reverse().map((n) => (
              <li
                key={n.date}
                className="flex items-center gap-3 px-4 h-9 border-b border-line last:border-b-0 hover:bg-panel-2"
              >
                <span className="num text-[12px] text-dim w-[92px] shrink-0">
                  {formatDateShort(n.date)}
                </span>
                <span className="num text-[12px] w-[52px] shrink-0">
                  {formatClock(n.sleepAt, settings.timezone)}
                </span>
                <span className="num text-[12px] w-[52px] shrink-0">
                  {formatClock(n.wakeAt, settings.timezone)}
                </span>
                <span
                  className={`num text-[12px] w-[64px] shrink-0 ${
                    n.durationMin == null ? 'text-faint' : n.onTarget ? 'text-done' : 'text-dim'
                  }`}
                >
                  {n.durationMin != null ? formatHoursMinutes(n.durationMin) : '—'}
                </span>
                <span className="quiet flex-1 truncate">{n.note ?? ''}</span>
                <Button size="sm" variant="ghost" onClick={() => setEditDate(n.date)}>
                  Edit
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  )
}

function Against({
  label,
  actual,
  target,
  tz,
  tol
}: {
  label: string
  actual: number | null | undefined
  target: string
  tz: string
  tol: number
}): React.JSX.Element {
  return (
    <div>
      <div className="micro">{label}</div>
      <div className="num text-[13px] mt-1">
        {actual != null ? formatClock(actual, tz) : '—'}
        <span className="text-faint"> vs {target}</span>
      </div>
      <div className="micro mt-0.5">±{tol}m</div>
    </div>
  )
}

/**
 * Two readings on one date axis.
 *
 * Bedtime dots are plotted on an 18:00-anchored vertical scale whose marks live
 * in a left gutter; the duration bars are indented to the same gutter so both
 * charts share one x-axis without sharing a y-axis.
 */
function DriftChart({
  nights,
  bedTargetPlot,
  tol,
  onPick
}: {
  nights: SleepNight[]
  bedTargetPlot: number
  tol: number
  onPick: (date: string) => void
}): React.JSX.Element {
  const GUTTER = 52
  const H = 132
  const SPAN = 720 // 18:00 → 06:00, the window a bedtime realistically falls in
  const y = (plot: number): number => Math.max(0, Math.min(1, plot / SPAN)) * H
  const maxDuration = Math.max(10 * 60, ...nights.map((n) => n.durationMin ?? 0))

  const marks = [0, 240, 480, 720].map((p) => ({ plot: p, label: plotMinutesToClock(p) }))

  return (
    <div>
      <div className="flex">
        <div className="shrink-0 relative" style={{ width: GUTTER, height: H }}>
          {marks.map((m) => (
            <span
              key={m.plot}
              className="absolute right-2 micro -translate-y-1/2"
              style={{ top: y(m.plot) }}
            >
              {m.label}
            </span>
          ))}
        </div>

        <div className="flex-1 min-w-0 relative border-l border-b border-line" style={{ height: H }}>
          {/* The tolerance band, with the target dashed through it. */}
          <div
            className="absolute left-0 right-0 bg-done opacity-15"
            style={{ top: y(bedTargetPlot - tol), height: Math.max(2, y(bedTargetPlot + tol) - y(bedTargetPlot - tol)) }}
          />
          <div
            className="absolute left-0 right-0 border-t border-dashed border-done opacity-60"
            style={{ top: y(bedTargetPlot) }}
          />
          <div className="absolute inset-0 flex">
            {nights.map((n) => (
              <div key={n.date} className="flex-1 min-w-0 relative">
                {n.bedtimePlot != null && (
                  <button
                    type="button"
                    onClick={() => onPick(n.date)}
                    title={`${formatDateShort(n.date)} · bedtime ${plotMinutesToClock(n.bedtimePlot)}`}
                    className="absolute left-1/2 w-[5px] h-[5px] -translate-x-1/2 -translate-y-1/2 bg-grace cursor-pointer"
                    style={{ top: y(n.bedtimePlot) }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex mt-2.5">
        <div className="shrink-0" style={{ width: GUTTER }} />
        <div className="flex-1 min-w-0 flex items-end gap-px" style={{ height: 72 }}>
          {nights.map((n) => {
            const minutes = n.durationMin ?? 0
            // Under six and a half hours is flagged, not scolded.
            const short = minutes > 0 && minutes < 390
            return (
              <div key={n.date} className="flex-1 min-w-0 h-full flex items-end bg-wait">
                <div
                  className={short ? 'w-full bg-missed' : n.onTarget ? 'w-full bg-done' : 'w-full bg-dim'}
                  style={{ height: `${(minutes / maxDuration) * 100}%` }}
                  title={`${formatDateShort(n.date)}: ${
                    n.durationMin != null ? formatHoursMinutes(n.durationMin) : 'not recorded'
                  }`}
                />
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex mt-1.5">
        <div className="shrink-0" style={{ width: GUTTER }} />
        <div className="flex-1 min-w-0 flex justify-between">
          <span className="micro">{formatDateShort(nights[0]?.date ?? '')}</span>
          <span className="micro">{formatDateShort(nights[nights.length - 1]?.date ?? '')}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-[18px] gap-y-1.5 mt-3">
        <Key label="Bedtime" className="bg-grace" />
        <Key label="Target ±window" className="bg-done opacity-40" />
        <Key label="On target" className="bg-done" />
        <Key label="Under 6:30" className="bg-missed" />
      </div>
    </div>
  )
}

function Key({ label, className }: { label: string; className: string }): React.JSX.Element {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-2 h-2 ${className}`} />
      <span className="micro">{label}</span>
    </span>
  )
}

/** Manual correction for the nights a button went unpressed. */
function ManualEdit({
  date,
  tz,
  nights,
  onPickDate,
  onSaved
}: {
  date: string
  tz: string
  nights: SleepNight[]
  onPickDate: (d: string) => void
  onSaved: () => void
}): React.JSX.Element {
  const action = useAction()
  const night = nights.find((n) => n.date === date) ?? null
  const [sleepAt, setSleepAt] = useState('')
  const [wakeAt, setWakeAt] = useState('')

  useEffect(() => {
    setSleepAt(night?.sleepAt ? formatClock(night.sleepAt, tz) : '')
    setWakeAt(night?.wakeAt ? formatClock(night.wakeAt, tz) : '')
  }, [night?.date, night?.sleepAt, night?.wakeAt, tz])

  const toInstant = (hhmm: string, kind: 'sleep' | 'wake'): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
    if (!m) return null
    const [y, mo, d] = date.split('-').map(Number)
    const hour = Number(m[1])
    // A bedtime before 18:00, and every wake time, lands the following morning.
    const rollsOver = kind === 'wake' ? true : hour < 18
    return new Date(y, mo - 1, d + (rollsOver ? 1 : 0), hour, Number(m[2]), 0, 0).getTime()
  }

  const apply = (): void => {
    void action
      .run(() =>
        api.editSleep(date, {
          sleepAt: sleepAt.trim() ? toInstant(sleepAt, 'sleep') : null,
          wakeAt: wakeAt.trim() ? toInstant(wakeAt, 'wake') : null
        })
      )
      .then((ok) => ok && onSaved())
  }

  return (
    <>
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="block">
          <span className="micro block mb-1.5">Night of</span>
          <select
            value={date}
            onChange={(e) => onPickDate(e.target.value)}
            className="w-[132px]"
          >
            {[...nights].reverse().map((n) => (
              <option key={n.date} value={n.date}>
                {formatDateShort(n.date)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="micro block mb-1.5">Slept</span>
          <input
            type="time"
            value={sleepAt}
            onChange={(e) => setSleepAt(e.target.value)}
            className="w-[104px]"
          />
        </label>
        <label className="block">
          <span className="micro block mb-1.5">Woke</span>
          <input
            type="time"
            value={wakeAt}
            onChange={(e) => setWakeAt(e.target.value)}
            className="w-[104px]"
          />
        </label>
        <Button onClick={apply}>Apply</Button>
      </div>
      {action.error && (
        <div className="mt-2.5">
          <Note tone="warn">{action.error.message}</Note>
        </div>
      )}
    </>
  )
}
