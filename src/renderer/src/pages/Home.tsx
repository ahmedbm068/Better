/**
 * Today — the home screen, in four tiers.
 *
 *   1  status bar   the day's score, its shape, and what is still open
 *   2  hero         the open window, plus a day rail showing where we are in it
 *   3  checklist    prayers, habits and avoid merged into one scannable column
 *   4  right rail   everything real but secondary, demoted rather than deleted
 *
 * The single accent marks the live thing and the one primary action. Nothing
 * here fakes a zero: no data renders as an em dash.
 */
import { useState } from 'react'
import type { DaySnapshot, PrayerStatus, QuitStats, Settings, WorkSession } from '@shared/types'
import type { SleepNight, StatsResult, WorkTotals } from '@shared/api'
import { PRAYER_LABELS } from '@shared/types'
import {
  formatClock,
  formatDateLong,
  formatDurationShort,
  formatHoursMinutes,
  formatMoney,
  formatSecondsAsHours,
  formatStopwatch,
  WEEKDAY_NAMES
} from '@shared/format'
import { weekdaysFromMask } from '@shared/streaks'
import { wallMinutes } from '@shared/time'
import { api } from '../lib/api'
import { useAction, useAsync, useNow } from '../lib/hooks'
import { useNav } from '../lib/nav'
import {
  Button,
  CheckRow,
  DayStrip,
  Empty,
  Kicker,
  MarkSmokeFree,
  Meter,
  MiniBars,
  Modal,
  Note,
  Panel,
  StreakBadge
} from '../components/ui'

export default function HomePage(): React.JSX.Element {
  const now = useNow(1000)
  const { data: today } = useAsync(() => api.currentDate(), [])
  const { data: settings } = useAsync(() => api.getSettings(), [])
  const { data: day, reload } = useAsync(
    () => (today ? api.getDay(today) : Promise.resolve(null)),
    [today]
  )
  const { data: quit } = useAsync(() => api.getQuitStats(), [])
  const { data: totals } = useAsync(() => api.getWorkTotals(), [])
  const { data: stats } = useAsync(() => api.getStats(14), [])
  const { data: nights } = useAsync(() => api.getRecentNights(14), [])
  const action = useAction()

  if (!day || !settings || !today) return <div className="p-[18px] text-faint">Loading…</div>

  const run = (fn: () => Promise<unknown>): void => {
    void action.run(fn).then(() => reload())
  }

  return (
    <div className="pb-5">
      <StatusStrip day={day} settings={settings} stats={stats} />

      {action.error && (
        <div className="px-[18px] pt-3">
          <Note tone={action.error.isGuard ? 'info' : 'warn'}>{action.error.message}</Note>
        </div>
      )}

      <div className="px-[18px] pt-4">
        <Hero day={day} now={now} settings={settings} run={run} />
      </div>

      <div className="px-[18px] pt-2.5 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_296px] gap-2.5 items-start">
        <Checklist day={day} now={now} settings={settings} run={run} />
        <div className="space-y-2.5">
          <ScoreBreakdown day={day} />
          <QuitPanel quit={quit} />
          <FocusPanel totals={totals} stats={stats} now={now} run={run} />
          <SleepPanel day={day} settings={settings} nights={nights?.nights} run={run} />
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ tier 1 */

function StatusStrip({
  day,
  settings,
  stats
}: {
  day: DaySnapshot
  settings: Settings
  stats: StatsResult | null
}): React.JSX.Element {
  const prayersDone = day.prayers.filter((p) => p.state === 'done').length
  const prayersLate = day.prayers.filter((p) => p.state === 'late').length
  const applicable = day.habits.filter((h) => h.applies)
  const habitsDone = applicable.filter((h) => h.done).length
  const clean = day.avoid.filter((a) => a.status !== 'slip').length
  const graceLeft = day.habits.filter((h) => h.streak.graceAvailable).length
  const spark = (stats?.series ?? []).map((p) => p.score / 100)

  return (
    <div className="h-11 px-[18px] border-b border-line flex items-center gap-6 bg-panel">
      <div className="flex items-baseline gap-2.5 shrink-0">
        <span className="micro">Score</span>
        <span className="num text-[20px] font-medium leading-none">{day.score.total}</span>
        {spark.length > 1 && <MiniBars values={spark} height={14} className="w-[92px]" />}
      </div>

      <div className="w-px h-5 bg-line" />

      <div className="flex items-center gap-5 min-w-0 overflow-hidden">
        <Counter
          label={prayersLate > 0 ? `Prayers · ${prayersLate} late` : 'Prayers'}
          value={`${prayersDone + prayersLate}/5`}
        />
        <Counter label="Habits" value={`${habitsDone}/${applicable.length}`} />
        <Counter label="Clean" value={`${clean}/${day.avoid.length}`} />
        <Counter label="Grace left" value={`${graceLeft}/${day.habits.length}`} />
      </div>

      <div className="ml-auto flex items-center gap-5 shrink-0">
        <span className="micro">{formatDateLong(day.date)}</span>
        <span className="micro">
          Rollover{' '}
          {settings.dayStartOffsetMin === 0
            ? 'at Fajr'
            : `Fajr ${settings.dayStartOffsetMin > 0 ? '+' : ''}${settings.dayStartOffsetMin}m`}
        </span>
      </div>
    </div>
  )
}

function Counter({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <span className="flex items-baseline gap-2 shrink-0">
      <span className="micro">{label}</span>
      <span className="num text-[13px]">{value}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ tier 2 */

function Hero({
  day,
  now,
  settings,
  run
}: {
  day: DaySnapshot
  now: number
  settings: Settings
  run: (fn: () => Promise<unknown>) => void
}): React.JSX.Element {
  const open = day.prayers.find((p) => now >= p.start && now < p.end) ?? null
  const next = day.prayers.filter((p) => p.start > now).sort((a, b) => a.start - b.start)[0] ?? null
  const subject = open ?? next
  const left = open ? open.end - now : next ? next.start - now : 0
  // Under twenty minutes the countdown turns; it never becomes an alarm.
  const urgent = open != null && open.state !== 'done' && left <= 20 * 60_000

  return (
    <Panel live pad={false}>
      <div className="flex flex-col xl:flex-row">
        <div className="p-6 xl:w-[420px] shrink-0 xl:border-r border-line">
          <div className="kicker">
            {open
              ? open.state === 'done'
                ? 'Window open · checked'
                : 'Window open'
              : 'Next arrival'}
          </div>
          <div className="text-[38px] leading-none font-semibold tracking-[-0.01em] mt-3">
            {subject ? PRAYER_LABELS[subject.prayer] : '—'}
          </div>
          <div
            className={`num text-[66px] leading-none font-medium tracking-[-0.03em] mt-3
              ${open ? (open.state === 'done' ? 'text-dim' : urgent ? 'text-missed' : 'text-accent') : 'text-dim'}
              ${urgent ? 'pulse' : ''}`}
          >
            {subject ? formatDurationShort(left) : '—'}
          </div>

          {open && (
            <div className="mt-4">
              <Meter
                value={Math.min(
                  100,
                  ((now - open.start) / Math.max(1, open.end - open.start)) * 100
                )}
                tone={open.state === 'done' ? 'done' : urgent ? 'missed' : 'accent'}
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-3 mt-3">
            <span className="micro">
              {open
                ? `Closes ${formatClock(open.end, settings.timezone)}`
                : next
                  ? `Opens ${formatClock(next.start, settings.timezone)}`
                  : 'All windows closed'}
            </span>
            {open && open.state !== 'done' && (
              <Button
                variant="primary"
                onClick={() => run(() => api.checkPrayer(day.date, open.prayer))}
              >
                Check {PRAYER_LABELS[open.prayer]}
              </Button>
            )}
          </div>
        </div>

        <DayRail day={day} now={now} settings={settings} subject={subject} />
      </div>
    </Panel>
  )
}

/**
 * The day as one 24-hour track.
 *
 * Bands are positioned by time; their labels are not. The labels sit in an
 * evenly divided five-cell row beneath, because Maghrib and Isha sit close
 * enough together that time-positioned text would collide.
 */
function DayRail({
  day,
  now,
  settings,
  subject
}: {
  day: DaySnapshot
  now: number
  settings: Settings
  subject: PrayerStatus | null
}): React.JSX.Element {
  const tz = settings.timezone
  const pct = (ms: number): number => (wallMinutes(ms, tz) / 1440) * 100
  const nowPct = (wallMinutes(now, tz) / 1440) * 100

  const bandColor = (s: PrayerStatus): string =>
    s.state === 'done'
      ? 'var(--done)'
      : s.state === 'late'
        ? 'var(--late)'
        : s.state === 'missed'
          ? 'var(--missed)'
          : s.state === 'open'
            ? 'var(--accent)'
            : 'var(--wait)'

  return (
    <div className="flex-1 min-w-0 px-6 pt-4 pb-[18px]">
      <div className="flex items-baseline justify-between">
        <span className="kicker">Day window</span>
        <span className="micro">
          {formatClock(now, tz)} · {Math.round(nowPct)}% elapsed
        </span>
      </div>

      <div className="relative h-0.5 bg-line-strong mt-[30px]">
        <div className="absolute left-0 top-0 h-0.5 bg-faint" style={{ width: `${nowPct}%` }} />

        {day.prayers.map((s) => {
          const start = pct(s.start)
          // Isha runs past midnight; clamp so its band cannot wrap the track.
          const rawEnd = pct(s.end)
          const end = Math.max(start, Math.min(100, rawEnd < start ? 100 : rawEnd))
          return (
            <div
              key={s.prayer}
              title={`${PRAYER_LABELS[s.prayer]} ${formatClock(s.start, tz)} – ${formatClock(s.end, tz)}`}
              className="absolute -top-[9px] h-1.5"
              style={{
                left: `${start}%`,
                width: `${Math.max(0.4, end - start)}%`,
                background: bandColor(s)
              }}
            />
          )
        })}

        {/* Sunrise is a bare tick: it closes Fajr but is not itself a prayer. */}
        <div
          className="absolute top-0.5 w-px h-[9px] bg-line-strong"
          style={{ left: `${pct(day.prayers[0].end)}%` }}
          title={`Sunrise ${formatClock(day.prayers[0].end, tz)}`}
        />

        <div
          className="absolute -top-[15px] flex flex-col items-center -translate-x-1/2"
          style={{ left: `${nowPct}%` }}
        >
          <span className="num text-[10.5px] text-accent mb-0.5">NOW</span>
          <span className="w-px h-5 bg-accent" />
        </div>
      </div>

      <div className="flex mt-6 border-t border-line">
        {day.prayers.map((s) => {
          const isSubject = subject?.prayer === s.prayer
          const labelColor = isSubject
            ? 'text-accent'
            : s.state === 'done'
              ? 'text-done'
              : s.state === 'late'
                ? 'text-late'
                : s.state === 'missed'
                  ? 'text-missed'
                  : 'text-dim'
          return (
            <span
              key={s.prayer}
              className="flex-1 min-w-0 flex flex-col gap-[3px] pt-[9px] pl-[11px] border-l border-line first:border-l-0 first:pl-0"
            >
              <span className={`text-[10.5px] font-bold tracking-[0.11em] uppercase ${labelColor}`}>
                {PRAYER_LABELS[s.prayer]}
              </span>
              <span className={`num text-[13px] ${isSubject ? 'text-fg' : 'text-faint'}`}>
                {formatClock(s.start, tz)} → {formatClock(s.end, tz)}
              </span>
            </span>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-x-[18px] gap-y-1.5 mt-3">
        <LegendKey label="Done" fill="bg-done" border="border-done" />
        <LegendKey label="Missed" border="border-missed" />
        <LegendKey label="Grace day" border="border-grace" />
        <LegendKey label="Untracked" border="border-line-strong" />
      </div>
    </div>
  )
}

function LegendKey({
  label,
  fill = '',
  border
}: {
  label: string
  fill?: string
  border: string
}): React.JSX.Element {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-[7px] h-[7px] border ${border} ${fill}`} />
      <span className="micro">{label}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ tier 3 */

function Checklist({
  day,
  now,
  settings,
  run
}: {
  day: DaySnapshot
  now: number
  settings: Settings
  run: (fn: () => Promise<unknown>) => void
}): React.JSX.Element {
  const { go } = useNav()
  const [expanded, setExpanded] = useState<number | null>(null)
  const [slipFor, setSlipFor] = useState<{ id: number; name: string } | null>(null)
  const [note, setNote] = useState('')

  const applicable = day.habits.filter((h) => h.applies)
  const prayersDone = day.prayers.filter((p) => p.state === 'done').length
  const prayersLate = day.prayers.filter((p) => p.state === 'late').length
  const clean = day.avoid.filter((a) => a.status !== 'slip').length

  const logSlip = (): void => {
    if (!slipFor) return
    run(() => api.setAvoidStatus(day.date, slipFor.id, 'slip', note || null))
    setSlipFor(null)
    setNote('')
  }

  const stripDays = (history: DaySnapshot['habits'][number]['history']) =>
    history.map((d) => ({
      date: d.date,
      done: d.done,
      grace: d.grace,
      applies: d.applies,
      tracked: d.tracked,
      // Only a tracked, applicable, unfinished day is a miss.
      missed: d.tracked && d.applies && !d.done && !d.grace
    }))

  return (
    <Panel
      title="Today"
      pad={false}
      right={<span className="num text-[11px] text-faint">{day.date}</span>}
    >
      <div className="px-4 pt-3 pb-1.5">
        <Kicker
          right={
            <span className="num text-[11px] text-faint">
              {prayersDone + prayersLate}/5{prayersLate > 0 && ` · ${prayersLate} late`}
            </span>
          }
        >
          Prayers
        </Kicker>
      </div>
      <div>
        {day.prayers.map((s) => {
          const isOpen = now >= s.start && now < s.end
          // Closed, but still inside the make-up window: the row stays live so
          // a missed prayer can be recorded as prayed, and undone if mis-tapped.
          const editable = isOpen || s.canMakeUp
          return (
            <CheckRow
              key={s.prayer}
              state={s.state}
              onToggle={
                editable
                  ? () =>
                      run(() =>
                        s.state === 'done' || s.state === 'late'
                          ? api.uncheckPrayer(day.date, s.prayer)
                          : api.checkPrayer(day.date, s.prayer)
                      )
                  : undefined
              }
              label={PRAYER_LABELS[s.prayer]}
              right={
                <span className="flex items-center gap-3 shrink-0">
                  {isOpen && s.state !== 'done' && (
                    <span className="w-16">
                      <Meter
                        value={((now - s.start) / Math.max(1, s.end - s.start)) * 100}
                        height={3}
                      />
                    </span>
                  )}
                  {s.state === 'missed' && s.canMakeUp && (
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Record this as prayed after its window closed"
                      onClick={() => run(() => api.checkPrayer(day.date, s.prayer))}
                    >
                      Make up
                    </Button>
                  )}
                  <span
                    className={`num text-[11px] w-[104px] text-right ${
                      s.state === 'missed'
                        ? 'text-missed'
                        : s.state === 'done'
                          ? 'text-done'
                          : s.state === 'late'
                            ? 'text-late'
                            : s.state === 'open'
                              ? 'text-accent'
                              : 'text-faint'
                    }`}
                  >
                    {s.state === 'done' && `logged ${formatClock(s.doneAt, settings.timezone)}`}
                    {s.state === 'late' && `made up ${formatClock(s.doneAt, settings.timezone)}`}
                    {s.state === 'missed' && 'MISSED'}
                    {s.state === 'open' && `${formatDurationShort(s.end - now)} left`}
                    {s.state === 'upcoming' && formatClock(s.start, settings.timezone)}
                  </span>
                </span>
              }
            />
          )
        })}
      </div>

      <div className="px-4 pt-4 pb-1.5 border-t-2 border-line-strong">
        <Kicker
          right={
            <span className="num text-[11px] text-faint">
              {applicable.filter((h) => h.done).length}/{applicable.length}
            </span>
          }
        >
          Habits
        </Kicker>
      </div>
      {day.habits.length === 0 ? (
        <Empty>
          No habits yet.{' '}
          <button className="underline cursor-pointer" onClick={() => go('lists')}>
            Add some
          </button>
        </Empty>
      ) : (
        <div>
          {day.habits.map((h) => (
            <div key={h.habit.id}>
              <CheckRow
                state={h.done ? 'done' : h.grace ? 'grace' : 'upcoming'}
                dim={!h.applies}
                onToggle={
                  h.applies
                    ? () => run(() => api.setHabitDone(day.date, h.habit.id, !h.done))
                    : undefined
                }
                label={h.habit.name}
                onLabelClick={() => setExpanded(expanded === h.habit.id ? null : h.habit.id)}
                sub={
                  !h.applies ? (
                    'Not scheduled today'
                  ) : h.grace ? (
                    <span className="text-grace">Grace day</span>
                  ) : undefined
                }
                right={
                  <span className="flex items-center gap-3 shrink-0">
                    <DayStrip days={stripDays(h.history.slice(-7))} />
                    <StreakBadge current={h.streak.current} record={h.streak.record} />
                  </span>
                }
              />
              {expanded === h.habit.id && (
                <div className="px-4 py-3 bg-panel-2 border-b border-line">
                  <div className="flex flex-wrap gap-x-8 gap-y-2 mb-3">
                    <Detail label="Streak" value={String(h.streak.current)} />
                    <Detail label="Record" value={String(h.streak.record)} />
                    <Detail label="This month" value={`${h.monthDone}/${h.monthApplicable}`} />
                    <Detail
                      label="Applies"
                      value={
                        weekdaysFromMask(h.habit.daysMask).length === 7
                          ? 'Every day'
                          : weekdaysFromMask(h.habit.daysMask)
                              .map((d) => WEEKDAY_NAMES[d])
                              .join(' ')
                      }
                    />
                    <Detail
                      label="Grace"
                      value={h.streak.graceAvailable ? 'Available' : 'Used this month'}
                    />
                  </div>
                  <div className="micro mb-1.5">Last 30 days</div>
                  <DayStrip tall days={stripDays(h.history)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="px-4 pt-4 pb-1.5 border-t-2 border-line-strong">
        <Kicker
          right={
            <span className="num text-[11px] text-faint">
              {clean}/{day.avoid.length} clean
            </span>
          }
        >
          Avoid
        </Kicker>
      </div>
      {day.avoid.length === 0 ? (
        <Empty>Nothing on the avoid list.</Empty>
      ) : (
        <div>
          {day.avoid.map((a) => (
            <CheckRow
              key={a.item.id}
              state={a.status === 'clean' ? 'done' : a.status === 'slip' ? 'missed' : 'upcoming'}
              onToggle={() =>
                run(() =>
                  api.setAvoidStatus(day.date, a.item.id, a.status === 'clean' ? null : 'clean', null)
                )
              }
              label={a.item.name}
              sub={
                a.status === 'slip' ? (
                  <span className="text-missed">Slip{a.note ? ` — ${a.note}` : ''}</span>
                ) : undefined
              }
              right={
                <span className="flex items-center gap-2 shrink-0">
                  {a.item.isQuitTracker && <span className="micro">Pinned</span>}
                  <StreakBadge current={a.streak.current} record={a.streak.record} />
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Log a slip"
                    onClick={() => setSlipFor({ id: a.item.id, name: a.item.name })}
                  >
                    Log slip
                  </Button>
                </span>
              }
            />
          ))}
        </div>
      )}

      <Modal open={slipFor !== null} title="Log a slip" onClose={() => setSlipFor(null)}>
        <p className="quiet mb-2">{slipFor?.name}</p>
        <input
          type="text"
          value={note}
          maxLength={140}
          placeholder="What triggered it? (optional)"
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && logSlip()}
        />
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={() => setSlipFor(null)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={logSlip}>
            Log it
          </Button>
        </div>
      </Modal>
    </Panel>
  )
}

function Detail({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="micro">{label}</span>
      <span className="num text-[12px]">{value}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ tier 4 */

/** "3 of 5 in time", plus the make-ups when there are any. */
function prayerBasis(day: DaySnapshot): string {
  const done = day.prayers.filter((p) => p.state === 'done').length
  const late = day.prayers.filter((p) => p.state === 'late').length
  return late > 0 ? `${done} of 5 in time, ${late} made up` : `${done} of 5 prayed`
}

function ScoreBreakdown({ day }: { day: DaySnapshot }): React.JSX.Element {
  const applicable = day.habits.filter((h) => h.applies)
  const parts: Array<{ label: string; value: number; max: number; basis: string }> = [
    {
      label: 'Prayers',
      value: day.score.prayers,
      max: 40,
      basis: prayerBasis(day)
    },
    {
      label: 'Habits',
      value: day.score.habits,
      max: 25,
      basis: `${applicable.filter((h) => h.done).length} of ${applicable.length} done`
    },
    {
      label: 'Avoid',
      value: day.score.avoid,
      max: 20,
      basis: `${day.avoid.filter((a) => a.status !== 'slip').length} of ${day.avoid.length} clean`
    },
    {
      label: 'Sleep',
      value: day.score.sleep,
      max: 10,
      basis: day.sleepOnTarget ? 'On target' : 'Off target'
    },
    {
      label: 'Work',
      value: day.score.work,
      max: 5,
      basis: day.workSecToday > 0 ? formatSecondsAsHours(day.workSecToday) : 'None logged'
    }
  ]

  return (
    <Panel
      title="Score"
      right={
        <span className="num text-[13px]">
          {day.score.total}
          <span className="text-faint">/100</span>
        </span>
      }
    >
      <div className="space-y-3">
        {parts.map((p) => (
          <div key={p.label}>
            <div className="flex items-baseline justify-between gap-2 mb-1.5">
              <span className="text-[12px]">{p.label}</span>
              <span className="num text-[11px] text-faint">
                {p.value}/{p.max}
              </span>
            </div>
            <Meter value={p.value} max={p.max} height={3} tone={p.value === p.max ? 'done' : 'accent'} />
            <div className="quiet mt-1">{p.basis}</div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function QuitPanel({ quit }: { quit: QuitStats | null }): React.JSX.Element {
  const { go } = useNav()
  if (!quit) return <Panel title="Smoke-free">{null}</Panel>

  if (!quit.quitDate) {
    return (
      <Panel title="Smoke-free">
        <p className="quiet mb-3">Set a quit date to start the counter.</p>
        <Button size="sm" variant="ghost" onClick={() => go('settings')}>
          Open settings
        </Button>
      </Panel>
    )
  }

  return (
    <Panel title="Smoke-free" right={<MarkSmokeFree />}>
      <div className="flex items-baseline gap-2">
        <span className="num text-[36px] leading-none font-medium text-accent">{quit.days}</span>
        <span className="text-[11px] text-faint">{quit.days === 1 ? 'day' : 'days'}</span>
      </div>
      <dl className="mt-4 space-y-2">
        <RailRow label="Not smoked" value={quit.cigarettesAvoided.toLocaleString('en-US')} />
        <RailRow label="Saved" value={formatMoney(quit.moneySaved, quit.currency)} />
        <RailRow label="Since" value={quit.quitDate} />
        <RailRow label="Streak" value={`${quit.streak.current} / ${quit.streak.record}`} />
      </dl>
    </Panel>
  )
}

function RailRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex justify-between gap-3 items-baseline">
      <dt className="micro">{label}</dt>
      <dd className="num text-[12px]">{value}</dd>
    </div>
  )
}

function FocusPanel({
  totals,
  stats,
  now,
  run
}: {
  totals: WorkTotals | null
  stats: StatsResult | null
  now: number
  run: (fn: () => Promise<unknown>) => void
}): React.JSX.Element {
  const { go } = useNav()
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [project, setProject] = useState('')
  const [note, setNote] = useState('')
  const { data: projects } = useAsync(() => api.listProjects(), [])

  const running: WorkSession | null = totals?.running ?? null
  const week = (stats?.series ?? []).slice(-7)
  const peak = Math.max(1, ...week.map((d) => d.workSeconds))

  const start = (): void => {
    if (!project.trim()) return
    run(() => api.startWork(project))
    setProject('')
    setStarting(false)
  }
  const stop = (): void => {
    run(() => api.stopWork(note || null))
    setNote('')
    setStopping(false)
  }

  return (
    <Panel
      title="Focused work"
      live={running != null}
      right={
        <button className="micro hover:text-fg cursor-pointer" onClick={() => go('work')}>
          Details
        </button>
      }
    >
      {running ? (
        <>
          <div className="num text-[36px] leading-none font-medium text-accent">
            {formatStopwatch(now - running.startedAt)}
          </div>
          <div className="quiet mt-2 truncate">{running.project}</div>
        </>
      ) : (
        <>
          <div className="num text-[36px] leading-none font-medium">
            {totals && totals.todaySeconds > 0 ? formatSecondsAsHours(totals.todaySeconds) : '—'}
          </div>
          <div className="micro mt-2">Today</div>
        </>
      )}

      {week.length > 0 && (
        <MiniBars values={week.map((d) => d.workSeconds / peak)} className="mt-3.5" height={22} />
      )}

      <dl className="mt-3 space-y-2">
        <RailRow label="This week" value={totals ? formatSecondsAsHours(totals.weekSeconds) : '—'} />
      </dl>

      <div className="mt-4">
        {running ? (
          <Button className="w-full justify-center" onClick={() => setStopping(true)}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" className="w-full" onClick={() => setStarting(true)}>
            Start work
          </Button>
        )}
      </div>

      <Modal open={starting} title="Start a session" onClose={() => setStarting(false)}>
        <input
          type="text"
          value={project}
          list="home-projects"
          placeholder="What are you working on?"
          onChange={(e) => setProject(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && start()}
        />
        <datalist id="home-projects">
          {(projects ?? []).map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        {(projects ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {(projects ?? []).slice(0, 6).map((p) => (
              <button
                key={p}
                onClick={() => setProject(p)}
                className="text-[11px] px-2 h-6 border border-line text-dim
                  hover:border-accent hover:text-fg cursor-pointer"
              >
                {p}
              </button>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={() => setStarting(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={start} disabled={!project.trim()}>
            Start
          </Button>
        </div>
      </Modal>

      <Modal open={stopping} title="Stop session" onClose={() => setStopping(false)}>
        <p className="quiet mb-2">
          {running?.project} · {formatStopwatch(now - (running?.startedAt ?? now))}
        </p>
        <input
          type="text"
          value={note}
          maxLength={160}
          placeholder="What got done? (optional)"
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && stop()}
        />
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={() => setStopping(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={stop}>
            Stop
          </Button>
        </div>
      </Modal>
    </Panel>
  )
}

function SleepPanel({
  day,
  settings,
  nights,
  run
}: {
  day: DaySnapshot
  settings: Settings
  nights: SleepNight[] | undefined
  run: (fn: () => Promise<unknown>) => void
}): React.JSX.Element {
  const { go } = useNav()
  const sleep = day.sleep
  const minutes =
    sleep?.sleepAt != null && sleep?.wakeAt != null
      ? Math.round((sleep.wakeAt - sleep.sleepAt) / 60_000)
      : null
  const chart = (nights ?? []).map((n) => (n.durationMin ?? 0) / (10 * 60))

  return (
    <Panel
      title="Sleep"
      right={
        <button className="micro hover:text-fg cursor-pointer" onClick={() => go('sleep')}>
          Details
        </button>
      }
    >
      <div
        className={`num text-[36px] leading-none font-medium ${
          minutes == null ? 'text-faint' : day.sleepOnTarget ? 'text-done' : ''
        }`}
      >
        {minutes != null ? formatHoursMinutes(minutes) : '—'}
      </div>
      {chart.length > 0 && <MiniBars values={chart} className="mt-3.5" height={22} tone="dim" />}

      <dl className="mt-3 space-y-2">
        <RailRow label="Slept" value={formatClock(sleep?.sleepAt, settings.timezone)} />
        <RailRow label="Woke" value={formatClock(sleep?.wakeAt, settings.timezone)} />
        <RailRow label="Target" value={`${settings.targetBedtime}–${settings.targetWakeTime}`} />
      </dl>

      <div className="mt-4 flex gap-2">
        <Button className="flex-1 justify-center" onClick={() => run(() => api.goingToSleep())}>
          To sleep
        </Button>
        <Button className="flex-1 justify-center" onClick={() => run(() => api.wokeUp())}>
          Woke up
        </Button>
      </div>
    </Panel>
  )
}
