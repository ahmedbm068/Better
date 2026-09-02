/**
 * Today — the home screen, in four tiers.
 *
 *   1  header    the date, and nothing that competes with it
 *   2  the arc    where the day is, and the one number that is counting
 *   3  the list   everything still open, as one column; everything settled, folded away
 *   4  the tiles  focus, sleep and the quit counter, at a glance
 *
 * The rebuild is a subtraction. The old screen put nine panels on one plane and
 * asked you to find the important one; this one has a single focal point, and
 * anything already dealt with is collapsed behind a count.
 *
 * The single accent marks the live thing and the one primary action. Nothing
 * here fakes a zero: no data renders as an em dash.
 */
import { useState, type ReactNode } from 'react'
import type { DaySnapshot, QuitStats, Settings, WorkSession } from '@shared/types'
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
import { isoWeekNumber } from '@shared/time'
import { api } from '../lib/api'
import { useAction, useAsync, useNow } from '../lib/hooks'
import { useNav } from '../lib/nav'
import { DayArc, PrayerRow } from '../components/dayarc'
import { QuoteCard } from '../components/quote'
import {
  IconChevron,
  IconFlame,
  IconMoney,
  IconPlay,
  IconSleep,
  IconStop,
  IconWork,
  MarkAllPrayers,
  MarkSmokeFree
} from '../components/icons'
import {
  Button,
  CheckRow,
  Chip,
  DayStrip,
  Meter,
  MiniBars,
  Modal,
  Note,
  Panel,
  Ring,
  StreakBadge,
  type CheckState
} from '../components/ui'

type Run = (fn: () => Promise<unknown>) => void

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

  if (!day || !settings || !today) return <div className="p-6 text-faint">Loading…</div>

  const run: Run = (fn) => {
    void action.run(fn).then(() => reload())
  }

  return (
    <div className="mx-auto w-full max-w-280 px-6 py-5 space-y-4 stagger">
      <Header day={day} settings={settings} />

      {action.error && <Note tone={action.error.isGuard ? 'info' : 'warn'}>{action.error.message}</Note>}

      {/* The arc gives up the width it was not using, and the quote takes it. */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4">
        <Hero day={day} now={now} settings={settings} run={run} />
        <QuoteCard date={day.date} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_312px] gap-4 items-start">
        <OpenList day={day} run={run} />
        <Score day={day} stats={stats} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <FocusTile totals={totals} stats={stats} now={now} run={run} />
        <SleepTile day={day} settings={settings} nights={nights?.nights} run={run} />
        <QuitTile quit={quit} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ tier 1 */

function Header({ day, settings }: { day: DaySnapshot; settings: Settings }): React.JSX.Element {
  const rollover =
    settings.dayStartOffsetMin === 0
      ? 'The day rolls over at Fajr'
      : `The day rolls over ${settings.dayStartOffsetMin > 0 ? '+' : ''}${settings.dayStartOffsetMin}m from Fajr`
  const allPrayed = day.prayers.every((p) => p.state === 'done' || p.state === 'late')

  return (
    <header className="flex items-end justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] truncate">
          {formatDateLong(day.date)}
        </h1>
        <p className="micro mt-0.5" title={rollover}>
          Week {isoWeekNumber(day.date)}
        </p>
      </div>
      <div className="flex items-center gap-2 mb-1">
        {day.prayerStreak.current > 0 && (
          <Chip
            tone={day.prayerStreak.pure ? 'done' : 'grace'}
            title={
              day.prayerStreak.pure
                ? 'Every prayer on time, this whole run'
                : 'Kept — one or more days needed a catch-up before the next Fajr'
            }
          >
            <IconFlame size={12} />
            {day.prayerStreak.current}-day streak
          </Chip>
        )}
        {allPrayed && (
          <Chip tone="done">
            <MarkAllPrayers size={13} />
            All five prayed
          </Chip>
        )}
      </div>
    </header>
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
  run: Run
}): React.JSX.Element {
  const open = day.prayers.find((p) => now >= p.start && now < p.end) ?? null
  const next = day.prayers.filter((p) => p.start > now).sort((a, b) => a.start - b.start)[0] ?? null
  const subject = open ?? next
  const left = open ? open.end - now : next ? next.start - now : 0
  // Under twenty minutes the countdown turns; it never becomes an alarm.
  const urgent = open != null && open.state !== 'done' && left <= 20 * 60_000
  const checked = open?.state === 'done' || open?.state === 'late'

  const kicker = open ? (checked ? 'Window open · prayed' : 'Window open') : next ? 'Next' : 'Closed'
  const countdownTone = !open
    ? 'text-dim'
    : checked
      ? 'text-done'
      : urgent
        ? 'text-missed'
        : 'text-accent'

  return (
    <Panel
      live={open != null && !checked}
      pad={false}
      className="overflow-hidden h-full flex flex-col"
    >
      <div className="px-6 pt-5 flex-1 flex flex-col justify-center">
        <DayArc prayers={day.prayers} now={now} settings={settings}>
          <span className="kicker">{kicker}</span>
          <span className="text-[27px] leading-tight font-semibold tracking-[-0.02em] mt-1">
            {subject ? PRAYER_LABELS[subject.prayer] : 'All windows closed'}
          </span>
          <Countdown
            text={subject ? formatDurationShort(left) : '—'}
            className={`mt-2 ${countdownTone} ${urgent ? 'pulse' : ''}`}
          />
          <span className="micro mt-2">
            {open
              ? `closes ${formatClock(open.end, settings.timezone)}`
              : next
                ? `opens ${formatClock(next.start, settings.timezone)}`
                : 'until Fajr tomorrow'}
          </span>
        </DayArc>
      </div>

      {open && !checked && (
        <div className="px-6 pb-1 flex justify-center">
          <Button
            size="lg"
            variant="primary"
            className="min-w-55"
            onClick={() => run(() => api.checkPrayer(day.date, open.prayer))}
          >
            Mark {PRAYER_LABELS[open.prayer]} prayed
          </Button>
        </div>
      )}

      <div className="px-4 pt-4 pb-2 mt-3 border-t border-line">
        <PrayerRow
          prayers={day.prayers}
          settings={settings}
          subject={subject}
          now={now}
          onToggle={(p) =>
            run(() =>
              p.state === 'done' || p.state === 'late'
                ? api.uncheckPrayer(day.date, p.prayer)
                : api.checkPrayer(day.date, p.prayer)
            )
          }
        />
      </div>
    </Panel>
  )
}

/**
 * The countdown, with its units demoted.
 *
 * "1h 57m" set entirely at 54px monospace puts a full-width space between the
 * hours and the minutes and gives the unit letters the same weight as the
 * figures. Splitting them lets the numbers carry the line.
 */
function Countdown({ text, className = '' }: { text: string; className?: string }): React.JSX.Element {
  const parts = text.match(/\d+|[a-z]+|—/gi) ?? [text]
  return (
    <span className={`num text-[54px] leading-none font-medium tracking-[-0.03em] ${className}`}>
      {parts.map((part, i) =>
        /^\d+$/.test(part) ? (
          <span key={i}>{part}</span>
        ) : (
          <span key={i} className="text-[0.42em] opacity-55 ml-[0.06em] mr-[0.22em] last:mr-0">
            {part}
          </span>
        )
      )}
    </span>
  )
}

/* ------------------------------------------------------------------ tier 3 */

interface Row {
  key: string
  /** Which list it came from. Rows are grouped under this, never mixed. */
  kind: 'habit' | 'avoid'
  state: CheckState
  label: string
  sub?: ReactNode
  right?: ReactNode
  onToggle?: () => void
  onLabelClick?: () => void
  dim?: boolean
  /** Settled rows fold away behind a count. */
  settled: boolean
  detail?: ReactNode
}

/**
 * The habits and the avoid list, as one column in two labelled groups.
 *
 * Merging them into a single undifferentiated list was a step too far: "Read 20
 * minutes" and "No video games" are opposite instructions, and with the same
 * checkbox and no heading between them the avoid list simply disappeared. They
 * share the column — one place to look — but each group keeps its own kicker
 * and its own count, and Avoid counts *clean* rather than done.
 *
 * Prayers are no longer listed here at all. They are checked off on the arc's
 * own row, where their times already are.
 */
function OpenList({ day, run }: { day: DaySnapshot; run: Run }): React.JSX.Element {
  const { go } = useNav()
  const [showSettled, setShowSettled] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [slipFor, setSlipFor] = useState<{ id: number; name: string } | null>(null)
  const [note, setNote] = useState('')

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

  const rows: Row[] = []

  for (const h of day.habits) {
    const state: CheckState = h.done ? 'done' : h.grace ? 'grace' : 'upcoming'
    rows.push({
      key: `h-${h.habit.id}`,
      kind: 'habit',
      state,
      label: h.habit.name,
      dim: !h.applies,
      settled: h.done || h.grace || !h.applies,
      sub: !h.applies ? 'Not scheduled today' : h.grace ? 'Grace day' : undefined,
      onToggle: h.applies
        ? () => run(() => api.setHabitDone(day.date, h.habit.id, !h.done))
        : undefined,
      onLabelClick: () => setExpanded(expanded === h.habit.id ? null : h.habit.id),
      right: <StreakBadge current={h.streak.current} record={h.streak.record} />,
      detail:
        expanded === h.habit.id ? (
          <div className="mx-3 mb-2 px-3.5 py-3 rounded-lg bg-panel-2 pop-in">
            <div className="flex flex-wrap gap-x-7 gap-y-2 mb-3">
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
              <Detail label="Grace" value={h.streak.graceAvailable ? 'Available' : 'Used'} />
            </div>
            <div className="micro mb-1.5">Last 30 days</div>
            <DayStrip tall days={stripDays(h.history)} />
          </div>
        ) : undefined
    })
  }

  for (const a of day.avoid) {
    rows.push({
      key: `a-${a.item.id}`,
      kind: 'avoid',
      state: a.status === 'clean' ? 'done' : a.status === 'slip' ? 'missed' : 'upcoming',
      label: a.item.name,
      settled: a.status !== null,
      sub: a.status === 'slip' ? <span className="text-missed">Slip{a.note ? ` — ${a.note}` : ''}</span> : undefined,
      onToggle: () =>
        run(() =>
          api.setAvoidStatus(day.date, a.item.id, a.status === 'clean' ? null : 'clean', null)
        ),
      right: (
        <span className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            title="Log a slip"
            onClick={() => setSlipFor({ id: a.item.id, name: a.item.name })}
            className="text-[11.5px] text-faint hover:text-missed px-2 h-6 rounded-md
              opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer"
          >
            Log slip
          </button>
          <StreakBadge current={a.streak.current} record={a.streak.record} />
        </span>
      )
    })
  }

  const open = rows.filter((r) => !r.settled)
  const settled = rows.filter((r) => r.settled)
  const nothingTracked = day.habits.length === 0 && day.avoid.length === 0

  const habitsDone = day.habits.filter((h) => h.applies && h.done).length
  const habitsApply = day.habits.filter((h) => h.applies).length
  // Clean means "has not slipped", which is how the score, the week and the
  // stats all count it. An item nobody has touched today is still clean.
  const clean = day.avoid.filter((a) => a.status !== 'slip').length

  const render = (r: Row): React.JSX.Element => (
    <div key={r.key}>
      <CheckRow
        state={r.state}
        onToggle={r.onToggle}
        onLabelClick={r.onLabelClick}
        label={r.label}
        sub={r.sub}
        right={r.right}
        dim={r.dim}
      />
      {r.detail}
    </div>
  )

  /** A group renders only when it has rows, so an empty list leaves no heading. */
  const group = (rows: Row[], kind: Row['kind'], count: string): React.JSX.Element | null => {
    const mine = rows.filter((r) => r.kind === kind)
    if (mine.length === 0) return null
    return (
      <div className="px-3 pt-3 first:pt-1.5">
        <div className="flex items-baseline justify-between gap-3 px-0.5 pb-1">
          <span className="kicker">{kind === 'habit' ? 'Habits' : 'Avoid'}</span>
          <span className="num text-[11px] text-faint">{count}</span>
        </div>
        <div className="-mx-3">{mine.map(render)}</div>
      </div>
    )
  }

  return (
    <Panel
      title="What's left"
      pad={false}
      right={
        open.length > 0 ? <Chip tone="accent">{open.length}</Chip> : <Chip tone="done">Clear</Chip>
      }
    >
      <div className="pb-1.5">
        {open.length > 0 ? (
          <>
            {group(open, 'habit', `${habitsDone}/${habitsApply} done`)}
            {group(open, 'avoid', `${clean}/${day.avoid.length} clean`)}
          </>
        ) : (
          <div className="py-10 flex flex-col items-center gap-2.5 text-center pop-in">
            <MarkAllPrayers size={26} />
            <p className="text-[15px] font-medium">Nothing left today.</p>
            <p className="quiet max-w-70">
              {nothingTracked ? (
                <>
                  There is nothing on your lists yet.{' '}
                  <button
                    className="underline cursor-pointer hover:text-fg"
                    onClick={() => go('lists')}
                  >
                    Add a habit
                  </button>
                </>
              ) : (
                'Every habit and avoid item is settled.'
              )}
            </p>
          </div>
        )}
      </div>

      {settled.length > 0 && (
        <div className="border-t border-line">
          <button
            type="button"
            onClick={() => setShowSettled(!showSettled)}
            className="w-full flex items-center gap-2 px-4 h-10 text-dim hover:text-fg
              transition-colors cursor-pointer"
          >
            <IconChevron dir={showSettled ? 'down' : 'right'} size={15} />
            <span className="text-[12.5px]">Settled</span>
            <span className="num text-[11.5px] text-faint">{settled.length}</span>
          </button>
          {showSettled && (
            <div className="pb-1.5">
              {group(settled, 'habit', `${habitsDone}/${habitsApply} done`)}
              {group(settled, 'avoid', `${clean}/${day.avoid.length} clean`)}
            </div>
          )}
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
      <span className="num text-[12.5px]">{value}</span>
    </span>
  )
}

/** "3 of 5 in time", plus the make-ups when there are any. */
function prayerBasis(day: DaySnapshot): string {
  const done = day.prayers.filter((p) => p.state === 'done').length
  const late = day.prayers.filter((p) => p.state === 'late').length
  return late > 0 ? `${done} of 5 in time, ${late} made up` : `${done} of 5 prayed`
}

/**
 * The score, as a ring and five bars.
 *
 * The bars carry their own arithmetic in a tooltip rather than a caption — the
 * old panel printed a line of prose under every one of the five.
 */
function Score({ day, stats }: { day: DaySnapshot; stats: StatsResult | null }): React.JSX.Element {
  const applicable = day.habits.filter((h) => h.applies)
  const spark = (stats?.series ?? []).map((p) => p.score / 100)
  const parts = [
    { label: 'Prayers', value: day.score.prayers, max: 40, basis: prayerBasis(day) },
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
    <Panel title="Score">
      <div className="flex items-center gap-4">
        <Ring value={day.score.total} size={84} stroke={7}>
          <span className="num text-[27px] leading-none font-medium">{day.score.total}</span>
        </Ring>
        <div className="min-w-0 flex-1">
          <div className="micro">out of 100</div>
          {spark.length > 1 && <MiniBars values={spark} height={26} className="mt-2" tone="dim" />}
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {parts.map((p) => (
          <div key={p.label} title={p.basis}>
            <div className="flex items-baseline justify-between gap-2 mb-1.5">
              <span className="text-[12.5px] text-dim">{p.label}</span>
              <span className="num text-[11.5px] text-faint">
                {p.value}/{p.max}
              </span>
            </div>
            <Meter
              value={p.value}
              max={p.max}
              height={4}
              tone={p.value === p.max ? 'done' : 'accent'}
            />
          </div>
        ))}
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ tier 4 */

/** The shared shape of the three bottom tiles: icon, figure, meta, action. */
function Tile({
  icon,
  title,
  live,
  onDetails,
  children
}: {
  icon: ReactNode
  title: string
  live?: boolean
  onDetails?: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <Panel
      live={live}
      className="h-full flex flex-col"
      bodyClass="flex-1 flex flex-col"
      title={
        <span className="flex items-center gap-2">
          <span className="text-faint">{icon}</span>
          {title}
        </span>
      }
      right={
        onDetails && (
          <button
            className="micro hover:text-fg cursor-pointer transition-colors"
            onClick={onDetails}
          >
            Details
          </button>
        )
      }
    >
      {children}
    </Panel>
  )
}

/** A week shape, unless the week is empty — then it is seven grey boxes. */
function WeekShape({
  values,
  tone
}: {
  values: number[]
  tone?: 'accent' | 'dim'
}): React.JSX.Element | null {
  if (values.length === 0 || values.every((v) => v <= 0)) return null
  return <MiniBars values={values} className="mt-3.5" height={24} tone={tone} />
}

function Figure({
  value,
  unit,
  tone = ''
}: {
  value: string
  unit?: string
  tone?: string
}): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`num text-[34px] leading-none font-medium tracking-[-0.03em] ${tone}`}>
        {value}
      </span>
      {unit && <span className="text-[12px] text-faint">{unit}</span>}
    </div>
  )
}

function FocusTile({
  totals,
  stats,
  now,
  run
}: {
  totals: WorkTotals | null
  stats: StatsResult | null
  now: number
  run: Run
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
    <Tile icon={<IconWork size={15} />} title="Focus" live={running != null} onDetails={() => go('work')}>
      {running ? (
        <>
          <Figure value={formatStopwatch(now - running.startedAt)} tone="text-accent" />
          <div className="quiet mt-2 truncate">{running.project}</div>
        </>
      ) : (
        <>
          <Figure
            value={totals && totals.todaySeconds > 0 ? formatSecondsAsHours(totals.todaySeconds) : '—'}
            unit={totals && totals.todaySeconds > 0 ? 'today' : undefined}
          />
          <div className="quiet mt-2">
            {totals && totals.weekSeconds > 0
              ? `${formatSecondsAsHours(totals.weekSeconds)} this week`
              : 'Nothing logged yet'}
          </div>
        </>
      )}

      <WeekShape values={week.map((d) => d.workSeconds / peak)} />

      <div className="mt-auto pt-4">
        {running ? (
          <Button className="w-full" onClick={() => setStopping(true)}>
            <IconStop size={13} />
            Stop
          </Button>
        ) : (
          <Button className="w-full" onClick={() => setStarting(true)}>
            <IconPlay size={13} />
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
          <div className="flex flex-wrap gap-1.5 mt-3">
            {(projects ?? []).slice(0, 6).map((p) => (
              <button
                key={p}
                onClick={() => setProject(p)}
                className="text-[11.5px] px-2.5 h-7 rounded-full bg-panel-2 text-dim
                  hover:text-fg hover:bg-accent-ghost cursor-pointer transition-colors"
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
    </Tile>
  )
}

function SleepTile({
  day,
  settings,
  nights,
  run
}: {
  day: DaySnapshot
  settings: Settings
  nights: SleepNight[] | undefined
  run: Run
}): React.JSX.Element {
  const { go } = useNav()
  const sleep = day.sleep
  const minutes =
    sleep?.sleepAt != null && sleep?.wakeAt != null
      ? Math.round((sleep.wakeAt - sleep.sleepAt) / 60_000)
      : null
  const chart = (nights ?? []).map((n) => (n.durationMin ?? 0) / (10 * 60))
  const logged = sleep?.sleepAt != null || sleep?.wakeAt != null

  return (
    <Tile icon={<IconSleep size={15} />} title="Sleep" onDetails={() => go('sleep')}>
      <Figure
        value={minutes != null ? formatHoursMinutes(minutes) : '—'}
        unit={minutes != null ? 'last night' : undefined}
        tone={minutes == null ? 'text-faint' : day.sleepOnTarget ? 'text-done' : ''}
      />
      <div className="quiet mt-2">
        {logged
          ? `${formatClock(sleep?.sleepAt, settings.timezone)} → ${formatClock(sleep?.wakeAt, settings.timezone)}`
          : `Target ${settings.targetBedtime}–${settings.targetWakeTime}`}
      </div>

      <WeekShape values={chart} tone="dim" />

      <div className="mt-auto pt-4 flex gap-2">
        <Button className="flex-1" onClick={() => run(() => api.goingToSleep())}>
          To sleep
        </Button>
        <Button className="flex-1" onClick={() => run(() => api.wokeUp())}>
          Woke up
        </Button>
      </div>
    </Tile>
  )
}

function QuitTile({ quit }: { quit: QuitStats | null }): React.JSX.Element {
  const { go } = useNav()

  if (!quit) return <Tile icon={<MarkSmokeFree size={15} />} title="Smoke-free">{null}</Tile>

  if (!quit.quitDate) {
    return (
      <Tile icon={<MarkSmokeFree size={15} />} title="Smoke-free">
        <Figure value="—" />
        <p className="quiet mt-2">Set a quit date to start the counter.</p>
        <Button className="w-full mt-auto" onClick={() => go('settings')}>
          Open settings
        </Button>
      </Tile>
    )
  }

  return (
    <Tile icon={<MarkSmokeFree size={15} />} title="Smoke-free">
      <Figure
        value={String(quit.days)}
        unit={quit.days === 1 ? 'day' : 'days'}
        tone="text-accent"
      />
      <div className="quiet mt-2">since {quit.quitDate}</div>

      <div className="mt-auto pt-4 flex flex-wrap gap-1.5">
        <Chip>
          <IconMoney size={12} />
          {formatMoney(quit.moneySaved, quit.currency)} saved
        </Chip>
        <Chip>{quit.cigarettesAvoided.toLocaleString('en-US')} not smoked</Chip>
        <StreakBadge current={quit.streak.current} record={quit.streak.record} />
      </div>
    </Tile>
  )
}
