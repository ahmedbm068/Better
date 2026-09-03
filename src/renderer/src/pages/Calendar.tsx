/**
 * Calendar — the month as a field of intensity.
 *
 * Each cell's ground is mixed from the accent in proportion to that day's
 * score, so a good stretch reads as a warm block before you read a single
 * number. Days before the app existed carry no marks, no score and no note
 * field: an untracked day is not a failure and must not look like one.
 */
import { useEffect, useState } from 'react'
import type { CalendarDay } from '@shared/api'
import { formatDateLong, formatMonthYear } from '@shared/format'
import { api } from '../lib/api'
import { useAction, useAsync } from '../lib/hooks'
import { useNav } from '../lib/nav'
import {
  Button,
  Empty,
  MarkAllPrayers,
  MarkSmokeFree,
  Panel,
  StatTile,
  Stepper
} from '../components/ui'

const WEEK_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function CalendarPage(): React.JSX.Element {
  const { go } = useNav()
  const now = new Date()
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 })

  const { data: month, reload } = useAsync(
    () => api.getMonth(cursor.year, cursor.month),
    [cursor.year, cursor.month]
  )

  const shift = (delta: number): void => {
    const index = cursor.month - 1 + delta
    setCursor({
      year: cursor.year + Math.floor(index / 12),
      month: (((index % 12) + 12) % 12) + 1
    })
  }

  if (!month) return <div className="p-4.5 text-faint">Loading…</div>

  const inMonth = month.days.filter((d) => Number(d.date.slice(5, 7)) === cursor.month)
  const scored = inMonth.filter((d) => d.tracked && !d.inFuture)
  const anyTracked = scored.length > 0

  const avgScore = anyTracked
    ? Math.round(scored.reduce((s, d) => s + d.score, 0) / scored.length)
    : null
  const prayerRate = anyTracked
    ? Math.round((scored.reduce((s, d) => s + d.prayersDone, 0) / (scored.length * 5)) * 100)
    : null
  const focused = anyTracked
    ? Math.round((scored.reduce((s, d) => s + d.workSeconds, 0) / 3600) * 10) / 10
    : null
  const graceUsed = anyTracked ? scored.filter((d) => d.hasGrace).length : null

  // Seven-day rows, so a five-week month leaves no dead row.
  const weeks: CalendarDay[][] = []
  for (let i = 0; i < month.days.length; i += 7) weeks.push(month.days.slice(i, i + 7))

  return (
    <div className="pb-5">
      <div className="h-11 px-3 md:px-4.5 border-b border-line flex items-center justify-between gap-4 bg-panel">
        <div className="flex items-baseline gap-4">
          <span className="label">Calendar</span>
          <span className="num text-[15px]">{formatMonthYear(cursor.year, cursor.month)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCursor({ year: now.getFullYear(), month: now.getMonth() + 1 })}
          >
            Today
          </Button>
          <Stepper
            onPrev={() => shift(-1)}
            onNext={() => shift(1)}
            prevLabel="Previous month"
            nextLabel="Next month"
          />
        </div>
      </div>

      <div className="px-3 md:px-4.5 pt-4">
        <div className="grid grid-cols-2 gap-px bg-line border border-line md:flex md:gap-0">
          <StatTile label="Avg score / tracked day" value={avgScore} />
          <StatTile label="Prayer rate" value={prayerRate} unit="%" />
          <StatTile label="Focused" value={focused} unit="h" />
          <StatTile label="Grace days used" value={graceUsed} />
        </div>
      </div>

      <div className="px-3 md:px-4.5 pt-2.5 flex gap-2.5 items-start">
        <Panel pad={false} className="flex-1 min-w-0">
          <div className="grid grid-cols-7 border-b-2 border-line-strong">
            {WEEK_HEADERS.map((d) => (
              <div key={d} className="micro px-2.5 py-2.5">
                {d}
              </div>
            ))}
          </div>

          {month.days.length === 0 ? (
            <Empty>Nothing to show.</Empty>
          ) : (
            <div className="grid grid-cols-7">
              {month.days.map((day, i) => (
                <DayCell
                  key={day.date}
                  day={day}
                  today={month.today}
                  month={cursor.month}
                  // The word is printed once per run of untracked days, not on
                  // every cell — repeating it turns absence into noise.
                  labelUntracked={!day.tracked && month.days[i - 1]?.tracked !== false}
                  onOpen={() => go('day', day.date)}
                  onSaved={reload}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel pad={false} className="w-38 shrink-0 hidden xl:block">
          <div className="micro px-3 py-2.5 border-b-2 border-line-strong">Week</div>
          {weeks.map((week, i) => {
            const rows = week.filter((d) => d.tracked && !d.inFuture)
            const avg = rows.length
              ? Math.round(rows.reduce((s, d) => s + d.score, 0) / rows.length)
              : null
            const rate = rows.length
              ? Math.round((rows.reduce((s, d) => s + d.prayersDone, 0) / (rows.length * 5)) * 100)
              : null
            const hours = rows.reduce((s, d) => s + d.workSeconds, 0) / 3600
            return (
              <div key={i} className="px-3 h-29.5 flex flex-col justify-center gap-1.5 border-b border-line last:border-b-0">
                <Meta label="Avg" value={avg === null ? '—' : String(avg)} />
                <Meta label="Prayers" value={rate === null ? '—' : `${rate}%`} />
                <Meta label="Focus" value={rows.length ? `${Math.round(hours * 10) / 10}h` : '—'} />
              </div>
            )
          })}
        </Panel>
      </div>

      {month.trackingStart && (
        <div className="px-3 md:px-4.5 pt-3">
          <span className="micro">
            No data before {formatDateLong(month.trackingStart)}
          </span>
        </div>
      )}
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="micro">{label}</span>
      <span className="num text-[12px]">{value}</span>
    </div>
  )
}

function DayCell({
  day,
  today,
  month,
  labelUntracked,
  onOpen,
  onSaved
}: {
  day: CalendarDay
  today: string
  month: number
  labelUntracked: boolean
  onOpen: () => void
  onSaved: () => void
}): React.JSX.Element {
  const action = useAction()
  const [note, setNote] = useState(day.note ?? '')
  useEffect(() => setNote(day.note ?? ''), [day.note])

  const isToday = day.date === today
  const otherMonth = Number(day.date.slice(5, 7)) !== month
  const blank = day.inFuture || !day.tracked

  // The one permitted tint: the day's score mixed into the panel ground.
  const ground = blank
    ? undefined
    : `color-mix(in oklab, var(--accent) ${(day.score * 0.2).toFixed(1)}%, var(--panel))`

  const save = (): void => {
    if (note === (day.note ?? '')) return
    void action.run(() => api.setDayNote(day.date, note)).then(onSaved)
  }

  return (
    <div
      className={`relative h-17.5 md:h-29.5 border-r border-b border-line p-1.5 md:p-2.5 flex flex-col
        ${otherMonth ? 'opacity-40' : ''}
        ${isToday ? 'border-t-2 border-t-accent border-l-2 border-l-accent' : ''}`}
      style={{ background: ground }}
    >
      <div className="flex items-start justify-between gap-1">
        <button
          type="button"
          onClick={blank ? undefined : onOpen}
          disabled={blank}
          className={`num text-[15px] md:text-[27px] leading-none font-medium text-left
            ${blank ? 'text-faint cursor-default' : 'cursor-pointer hover:text-accent'}`}
        >
          {Number(day.date.slice(8, 10))}
        </button>
        {isToday && <span className="micro text-accent hidden md:inline">Today</span>}
        {!blank && <span className="num text-[11px] md:text-[20px] leading-none text-dim">{day.score}</span>}
      </div>

      {/* Below the date, a phone-width cell only has room for the one signal
          that matters most — the score already tints the whole cell, so the
          marks, tags and note editor (unusable this narrow) fold away; tap
          the date to open the full day and see or edit them there. */}
      {blank ? (
        <div className="mt-auto micro hidden md:block">
          {!day.inFuture && labelUntracked ? 'Untracked' : ''}
        </div>
      ) : (
        <>
          <div className="hidden md:flex items-center gap-1.5 mt-1.5 h-4">
            {day.allPrayers && <MarkAllPrayers size={15} />}
            {day.quitClean && <MarkSmokeFree size={15} />}
          </div>

          <div className="hidden md:flex gap-2 mt-auto mb-1">
            {day.hasSlip && <span className="micro text-missed">Slip</span>}
            {day.hasGrace && <span className="micro text-grace">Grace</span>}
          </div>

          <input
            type="text"
            value={note}
            maxLength={120}
            placeholder="+ note"
            onChange={(e) => setNote(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="hidden md:block border-0! bg-transparent! px-0! py-0! text-[11px] text-dim w-full"
          />
        </>
      )}
    </div>
  )
}
