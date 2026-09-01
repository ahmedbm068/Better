/**
 * Week — seven columns, each one a day taken apart.
 *
 * The stacked bar under each score shows what the points were actually made
 * of, so a low day says *why* it was low rather than only that it was. Best and
 * worst are labelled outright: no hunting for them.
 */
import { useEffect, useState } from 'react'
import type { CalendarWeek } from '@shared/api'
import { addDays } from '@shared/time'
import { formatClock, formatDateShort, formatHoursMinutes, formatSecondsAsHours } from '@shared/format'
import { PRAYER_LABELS, type PrayerName } from '@shared/types'
import { api } from '../lib/api'
import { useAction, useAsync } from '../lib/hooks'
import { useNav } from '../lib/nav'
import { Button, Empty, MarkAllPrayers, MarkSmokeFree, Panel, StatTile, Stepper } from '../components/ui'

type WeekDay = CalendarWeek['days'][number]

/** The five score components, with the weights the app actually uses. */
const COMPONENTS: Array<{ key: keyof WeekDay['breakdown']; label: string; max: number; color: string }> = [
  { key: 'prayers', label: 'Prayers', max: 40, color: 'var(--accent)' },
  { key: 'habits', label: 'Habits', max: 25, color: 'var(--done)' },
  { key: 'avoid', label: 'Avoid', max: 20, color: 'var(--grace)' },
  { key: 'sleep', label: 'Sleep', max: 10, color: 'var(--text2)' },
  { key: 'work', label: 'Work', max: 5, color: 'var(--text3)' }
]

export default function WeekPage(): React.JSX.Element {
  const { data: today } = useAsync(() => api.currentDate(), [])
  const { data: settings } = useAsync(() => api.getSettings(), [])
  const [offset, setOffset] = useState(0)
  const anchor = today ? addDays(today, offset * 7) : null
  const { data: week, reload } = useAsync(
    () => (anchor ? api.getWeek(anchor) : Promise.resolve(null)),
    [anchor]
  )

  if (!week || !settings) return <div className="p-[18px] text-faint">Loading…</div>

  const tracked = week.days.filter((d) => d.tracked && !d.inFuture)
  const any = tracked.length > 0

  const avgScore = any ? Math.round(tracked.reduce((s, d) => s + d.score, 0) / tracked.length) : null
  const prayersDone = tracked.reduce((s, d) => s + d.prayersDone, 0)
  const workSeconds = tracked.reduce((s, d) => s + d.workSeconds, 0)
  const sleepNights = tracked.filter((d) => d.sleepMinutes != null)
  const avgSleep = sleepNights.length
    ? Math.round(sleepNights.reduce((s, d) => s + (d.sleepMinutes ?? 0), 0) / sleepNights.length)
    : null

  const ranked = [...tracked].sort((a, b) => b.score - a.score)
  const best = ranked[0] ?? null
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : null

  const shape = week.days.map((d) => (d.tracked && !d.inFuture ? d.score / 100 : 0))
  const delta = (now: number | null, before: number | null, unit = ''): string | null => {
    if (now === null || before === null) return null
    const d = Math.round((now - before) * 10) / 10
    return `${d >= 0 ? '+' : ''}${d}${unit} vs last week`
  }

  return (
    <div className="pb-5">
      <div className="h-11 px-[18px] border-b border-line flex items-center justify-between gap-4 bg-panel">
        <div className="flex items-baseline gap-4">
          <span className="label">Week</span>
          <span className="num text-[15px]">
            {formatDateShort(week.weekStart)} – {formatDateShort(week.weekEnd)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOffset(0)}>
            This week
          </Button>
          <Stepper
            onPrev={() => setOffset(offset - 1)}
            onNext={() => setOffset(offset + 1)}
            disableNext={offset >= 0}
            prevLabel="Previous week"
            nextLabel="Next week"
          />
        </div>
      </div>

      <div className="px-[18px] pt-4">
        <div className="flex border border-line bg-panel">
          <StatTile
            label="Avg score"
            value={avgScore}
            bars={shape}
            sub={delta(avgScore, week.previous.avgScore)}
          />
          <StatTile
            label="Prayers"
            value={any ? prayersDone : null}
            unit={`/ ${tracked.length * 5}`}
            sub={delta(prayersDone, week.previous.prayersDone)}
          />
          <StatTile
            label="Focused"
            value={any ? Math.round((workSeconds / 3600) * 10) / 10 : null}
            unit="h"
            sub={delta(workSeconds / 3600, week.previous.workSeconds / 3600, 'h')}
          />
          <StatTile
            label="Avg sleep"
            value={avgSleep != null ? formatHoursMinutes(avgSleep) : null}
            sub={
              avgSleep != null && week.previous.sleepMin != null
                ? delta(avgSleep / 60, week.previous.sleepMin / 60, 'h')
                : null
            }
          />
        </div>
      </div>

      <div className="px-[18px] pt-2.5">
        <Panel pad={false}>
          <div className="flex items-center justify-between gap-4 px-4 pt-3 pb-[11px] border-b-2 border-line-strong">
            <span className="label">Days</span>
            <span className="flex flex-wrap gap-x-3.5 gap-y-1">
              {COMPONENTS.map((c) => (
                <span key={c.label} className="flex items-center gap-1.5">
                  <span className="w-2 h-2" style={{ background: c.color }} />
                  <span className="micro">
                    {c.label} {c.max}
                  </span>
                </span>
              ))}
            </span>
          </div>

          {week.days.length === 0 ? (
            <Empty>Nothing recorded.</Empty>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-7 divide-y md:divide-y-0 md:divide-x divide-line">
              {week.days.map((day) => (
                <DayColumn
                  key={day.date}
                  day={day}
                  today={week.today}
                  tz={settings.timezone}
                  best={best?.date === day.date}
                  worst={worst?.date === day.date}
                  onSaved={reload}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

function DayColumn({
  day,
  today,
  tz,
  best,
  worst,
  onSaved
}: {
  day: WeekDay
  today: string
  tz: string
  best: boolean
  worst: boolean
  onSaved: () => void
}): React.JSX.Element {
  const { go } = useNav()
  const action = useAction()
  const [note, setNote] = useState(day.note ?? '')
  useEffect(() => setNote(day.note ?? ''), [day.note])

  const blank = day.inFuture || !day.tracked
  const isToday = day.date === today

  const save = (): void => {
    if (note === (day.note ?? '')) return
    void action.run(() => api.setDayNote(day.date, note)).then(onSaved)
  }

  return (
    <div className={`p-3 min-h-[420px] flex flex-col ${isToday ? 'bg-panel-2' : ''}`}>
      <div className="flex items-baseline justify-between gap-2">
        <button
          type="button"
          disabled={blank}
          onClick={() => go('day', day.date)}
          className={`micro ${blank ? 'cursor-default' : 'cursor-pointer hover:text-accent'} ${isToday ? 'text-accent' : ''}`}
        >
          {formatDateShort(day.date)}
        </button>
        {best && !blank && <span className="micro text-done">Best</span>}
        {worst && !blank && <span className="micro text-missed">Worst</span>}
      </div>

      {blank ? (
        <div className="mt-3 micro">{day.inFuture ? '—' : 'Untracked'}</div>
      ) : (
        <>
          <div className="num text-[36px] leading-none font-medium mt-2">{day.score}</div>

          <div className="flex items-center gap-1.5 h-4 mt-2">
            {day.allPrayers && <MarkAllPrayers size={15} />}
            {day.quitClean && <MarkSmokeFree size={15} />}
          </div>

          {/* What the points were made of, at a glance. */}
          <div className="flex gap-px h-1.5 mt-3" title={`Score ${day.score} of 100`}>
            {COMPONENTS.map((c) => (
              <span
                key={c.key}
                className="bg-wait relative"
                style={{ flex: c.max }}
                title={`${c.label} ${day.breakdown[c.key]}/${c.max}`}
              >
                <span
                  className="absolute inset-y-0 left-0"
                  style={{
                    width: `${(day.breakdown[c.key] / c.max) * 100}%`,
                    background: c.color
                  }}
                />
              </span>
            ))}
          </div>

          <div className="mt-3.5 space-y-1">
            {day.prayers.map((p) => (
              <div key={p.prayer} className="flex items-center justify-between gap-2">
                <span
                  className={`text-[11px] ${
                    p.state === 'done'
                      ? 'text-done'
                      : p.state === 'late'
                        ? 'text-late'
                        : p.state === 'missed'
                          ? 'text-missed'
                          : 'text-faint'
                  }`}
                >
                  {PRAYER_LABELS[p.prayer as PrayerName]}
                </span>
                <span className="num text-[10.5px] text-faint">{formatClock(p.start, tz)}</span>
              </div>
            ))}
          </div>

          <div className="mt-3 pt-2.5 border-t border-line space-y-1">
            {day.habitRows.map((h) => (
              <div key={h.id} className="flex items-center gap-2">
                <span
                  className={`w-1.5 h-1.5 shrink-0 border ${
                    h.done
                      ? 'bg-done border-done'
                      : h.grace
                        ? 'border-grace'
                        : h.applies
                          ? 'border-missed'
                          : 'border-line-strong opacity-50'
                  }`}
                />
                <span className={`text-[11px] truncate ${h.done ? 'text-dim' : 'text-faint'}`}>
                  {h.name}
                </span>
              </div>
            ))}
          </div>

          <dl className="mt-3 pt-2.5 border-t border-line space-y-1">
            <Row label="Focus" value={day.workSeconds ? formatSecondsAsHours(day.workSeconds) : '—'} />
            <Row
              label="Sleep"
              value={day.sleepMinutes != null ? formatHoursMinutes(day.sleepMinutes) : '—'}
            />
            {day.hasSlip && <Row label="Slip" value="logged" tone="text-missed" />}
            {day.hasGrace && <Row label="Grace" value="used" tone="text-grace" />}
          </dl>

          <input
            type="text"
            value={note}
            maxLength={120}
            placeholder="+ note"
            onChange={(e) => setNote(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="mt-auto border-0! bg-transparent! px-0! py-0! pt-3! text-[11px] text-dim w-full"
          />
        </>
      )}
    </div>
  )
}

function Row({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone?: string
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="micro">{label}</dt>
      <dd className={`num text-[11px] ${tone ?? 'text-dim'}`}>{value}</dd>
    </div>
  )
}
