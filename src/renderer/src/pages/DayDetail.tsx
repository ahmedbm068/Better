/**
 * Day detail — one day taken apart.
 *
 * The score sits left of a strip that breaks it into its five components, each
 * showing not only the points but what produced them. Past days are read-only
 * except the note and a prayer still inside its make-up window; the top bar
 * says so rather than leaving you to discover it.
 */
import { useEffect, useState } from 'react'
import type { DateStr } from '@shared/types'
import { PRAYER_LABELS } from '@shared/types'
import { daysBetween } from '@shared/time'
import {
  formatClock,
  formatDateLong,
  formatHoursMinutes,
  formatSecondsAsHours,
  formatStopwatch,
  WEEKDAY_NAMES
} from '@shared/format'
import { weekdaysFromMask } from '@shared/streaks'
import { api } from '../lib/api'
import { useAction, useAsync } from '../lib/hooks'
import { useNav } from '../lib/nav'
import {
  Button,
  Empty,
  MarkAllPrayers,
  MarkSmokeFree,
  Meter,
  Note,
  Panel,
  StreakBadge
} from '../components/ui'

export default function DayDetailPage({ date }: { date: DateStr }): React.JSX.Element {
  const { back, canGoBack, go } = useNav()
  const { data: settings } = useAsync(() => api.getSettings(), [])
  const { data: today } = useAsync(() => api.currentDate(), [])
  const { data: day, reload } = useAsync(() => api.getDay(date), [date])
  const action = useAction()

  const [note, setNote] = useState('')
  const [savedNote, setSavedNote] = useState('')

  useEffect(() => {
    setNote(day?.note ?? '')
    setSavedNote(day?.note ?? '')
  }, [day?.date, day?.note])

  if (!day || !settings || !today) return <div className="p-[18px] text-faint">Loading…</div>

  const tz = settings.timezone
  const prayersDone = day.prayers.filter((p) => p.state === 'done').length
  const prayersLate = day.prayers.filter((p) => p.state === 'late').length
  const applicable = day.habits.filter((h) => h.applies)
  // A grace day can be spent on today or yesterday — a break is usually noticed
  // the next morning, which is the case that actually matters.
  const graceAge = daysBetween(date, today)
  const graceOffered = day.tracked && graceAge >= 0 && graceAge <= 1

  const saveNote = (): void => {
    void action.run(() => api.setDayNote(date, note)).then(() => {
      setSavedNote(note)
      reload()
    })
  }

  const components: Array<{ label: string; value: number; max: number; basis: string }> = [
    {
      label: 'Prayers',
      value: day.score.prayers,
      max: 40,
      basis:
        prayersLate > 0
          ? `${prayersDone} of 5 in time, ${prayersLate} made up`
          : `${prayersDone} of 5 prayed`
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
      basis: day.sleepOnTarget ? 'Within tolerance' : 'Off target'
    },
    {
      label: 'Work',
      value: day.score.work,
      max: 5,
      basis: day.workSecToday ? formatSecondsAsHours(day.workSecToday) : 'None logged'
    }
  ]

  return (
    <div className="pb-5">
      <div className="h-11 px-[18px] border-b border-line flex items-center justify-between gap-4 bg-panel">
        <div className="flex items-center gap-4 min-w-0">
          {canGoBack && (
            <Button size="sm" variant="ghost" onClick={back}>
              ‹ Back
            </Button>
          )}
          <span className="num text-[15px] truncate">{formatDateLong(day.date)}</span>
          <span className="flex items-center gap-2 shrink-0">
            {prayersDone === 5 && <MarkAllPrayers size={15} />}
            {day.avoid.some((a) => a.item.isQuitTracker && a.status !== 'slip') && (
              <MarkSmokeFree size={15} />
            )}
          </span>
        </div>
        <span className="micro shrink-0">
          {!day.tracked
            ? 'Before tracking started'
            : day.isToday
              ? 'Today · editable'
              : day.isPast
                ? day.prayers.some((p) => p.canMakeUp)
                  ? 'Past day · note and make-ups only'
                  : 'Past day · read only except the note'
                : 'Upcoming'}
        </span>
      </div>

      {action.error && (
        <div className="px-[18px] pt-3">
          <Note tone={action.error.isGuard ? 'info' : 'warn'}>{action.error.message}</Note>
        </div>
      )}

      {!day.tracked && (
        <div className="px-[18px] pt-3">
          <Note>
            This day is before the app started tracking, so nothing here is counted or scored. The
            prayer times are shown for reference only.
          </Note>
        </div>
      )}

      <div className="px-[18px] pt-4">
        <Panel pad={false}>
          <div className="flex flex-col lg:flex-row">
            <div className="px-6 py-5 lg:w-[190px] shrink-0 lg:border-r border-line">
              <div className="micro">Score</div>
              <div className="num text-[54px] leading-none font-medium mt-2">
                {day.tracked ? day.score.total : '—'}
              </div>
              <div className="micro mt-2">of 100</div>
            </div>
            <div className="flex-1 flex flex-col sm:flex-row">
              {components.map((c) => (
                <div
                  key={c.label}
                  className="flex-1 min-w-0 px-5 py-5 border-t sm:border-t-0 sm:border-l border-line first:sm:border-l-0"
                >
                  <div className="micro mb-2">{c.label}</div>
                  <div className="num text-[20px] leading-none">
                    {day.tracked ? c.value : '—'}
                    <span className="text-faint text-[12px]">/{c.max}</span>
                  </div>
                  <div className="mt-2.5">
                    <Meter value={day.tracked ? c.value : 0} max={c.max} height={3} />
                  </div>
                  <div className="quiet mt-2">{day.tracked ? c.basis : 'Untracked'}</div>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <div className="px-[18px] pt-2.5 grid grid-cols-1 lg:grid-cols-3 gap-2.5 items-start">
        <div className="space-y-2.5">
          <Panel title="Prayers" pad={false}>
            <ul>
              {day.prayers.map((s) => (
                <li
                  key={s.prayer}
                  className="flex items-center gap-3 px-4 h-9 border-b border-line last:border-b-0"
                >
                  <span
                    className={`w-2 h-2 shrink-0 border ${
                      !day.tracked
                        ? 'border-line-strong'
                        : s.state === 'done'
                          ? 'bg-done border-done'
                          : s.state === 'late'
                            ? 'border-late'
                            : s.state === 'missed'
                              ? 'border-missed'
                              : s.state === 'open'
                                ? 'border-accent'
                                : 'border-line-strong'
                    }`}
                  />
                  <span className="w-[72px] shrink-0">{PRAYER_LABELS[s.prayer]}</span>
                  <span className="num text-[11px] text-faint w-[46px] shrink-0">
                    {formatClock(s.start, tz)}
                  </span>
                  <span
                    className={`num text-[11px] flex-1 text-right ${
                      !day.tracked
                        ? 'text-faint'
                        : s.state === 'done'
                          ? 'text-done'
                          : s.state === 'late'
                            ? 'text-late'
                            : s.state === 'missed'
                              ? 'text-missed'
                              : 'text-faint'
                    }`}
                  >
                    {!day.tracked
                      ? 'Not tracked'
                      : s.state === 'done'
                        ? `logged ${formatClock(s.doneAt, tz)}`
                        : s.state === 'late'
                          ? `made up ${formatClock(s.doneAt, tz)}`
                          : s.state === 'missed'
                            ? 'MISSED'
                            : s.state === 'open'
                              ? 'OPEN'
                              : 'UPCOMING'}
                  </span>
                  {/* The one thing a past day still allows. Yesterday's Isha is
                      only reachable here, because Today has moved on. */}
                  {day.tracked && s.canMakeUp && (
                    <Button
                      size="sm"
                      variant="ghost"
                      title={
                        s.state === 'late'
                          ? 'Withdraw this make-up'
                          : 'Record this as prayed after its window closed'
                      }
                      onClick={() =>
                        void action
                          .run(() =>
                            s.state === 'late'
                              ? api.uncheckPrayer(day.date, s.prayer)
                              : api.checkPrayer(day.date, s.prayer)
                          )
                          .then(reload)
                      }
                    >
                      {s.state === 'late' ? 'Undo' : 'Make up'}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Avoid" pad={false}>
            {day.avoid.length === 0 ? (
              <Empty>Nothing tracked.</Empty>
            ) : (
              <ul>
                {day.avoid.map((a) => (
                  <li key={a.item.id} className="px-4 py-2 border-b border-line last:border-b-0">
                    <div className="flex items-center gap-3">
                      <span
                        className={`w-2 h-2 shrink-0 border ${
                          a.status === 'slip'
                            ? 'border-missed'
                            : a.status === 'clean'
                              ? 'bg-done border-done'
                              : 'border-line-strong'
                        }`}
                      />
                      <span className="flex-1 truncate">{a.item.name}</span>
                      <span
                        className={`micro ${a.status === 'slip' ? 'text-missed' : ''}`}
                      >
                        {a.status === 'slip' ? 'Slip' : a.status === 'clean' ? 'Clean' : 'No entry'}
                      </span>
                      <StreakBadge current={a.streak.current} record={a.streak.record} />
                    </div>
                    {a.note && <div className="quiet text-missed pl-5 mt-1">{a.note}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-2.5">
          <Panel
            title="Habits"
            pad={false}
            right={graceOffered ? <span className="micro">One grace day per month</span> : undefined}
          >
            {day.habits.length === 0 ? (
              <Empty>No habits.</Empty>
            ) : (
              <ul>
                {day.habits.map((h) => {
                  const canGrace =
                    graceOffered && h.applies && !h.done && !h.grace && h.streak.graceAvailable
                  return (
                    <li
                      key={h.habit.id}
                      className="flex items-center gap-2.5 px-4 py-2 border-b border-line last:border-b-0"
                    >
                      <span
                        className={`w-2 h-2 shrink-0 border ${
                          !h.applies
                            ? 'border-line-strong opacity-50'
                            : h.done
                              ? 'bg-done border-done'
                              : h.grace
                                ? 'border-grace'
                                : 'border-missed'
                        }`}
                      />
                      <span className={`flex-1 truncate ${h.done ? 'text-dim' : ''}`}>
                        {h.habit.name}
                      </span>
                      <span className={`micro ${h.grace ? 'text-grace' : ''}`}>
                        {!h.applies
                          ? weekdaysFromMask(h.habit.daysMask)
                              .map((d) => WEEKDAY_NAMES[d][0])
                              .join('')
                          : h.done
                            ? 'Done'
                            : h.grace
                              ? 'Grace day'
                              : 'Not done'}
                      </span>
                      <StreakBadge current={h.streak.current} record={h.streak.record} />
                      {canGrace && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Keep the streak alive. Marked as a grace day, one per month."
                          onClick={() =>
                            void action
                              .run(() => api.useGraceDay(day.date, h.habit.id))
                              .then(() => reload())
                          }
                        >
                          Grace
                        </Button>
                      )}
                      {graceOffered && h.grace && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Give the grace day back"
                          onClick={() =>
                            void action
                              .run(() => api.clearGraceDay(day.date, h.habit.id))
                              .then(() => reload())
                          }
                        >
                          Undo
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>

          <Panel
            title="Work sessions"
            pad={false}
            right={
              <span className="num text-[11px] text-faint">
                {day.workSecToday ? formatStopwatch(day.workSecToday * 1000) : '—'}
              </span>
            }
          >
            {day.work.length === 0 ? (
              <Empty>No sessions.</Empty>
            ) : (
              <ul>
                {day.work.map((w) => (
                  <li key={w.id} className="px-4 py-2 border-b border-line last:border-b-0">
                    <div className="flex items-center gap-3">
                      <span className="flex-1 truncate">{w.project}</span>
                      <span className="num text-[12px] text-dim">
                        {formatStopwatch(w.durationSec * 1000)}
                      </span>
                    </div>
                    <div className="micro mt-0.5">
                      {formatClock(w.startedAt, tz)} →{' '}
                      {w.endedAt ? formatClock(w.endedAt, tz) : 'running'}
                    </div>
                    {w.note && <div className="quiet mt-1">{w.note}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-2.5">
          <Panel
            title="Sleep"
            right={
              <button className="micro hover:text-fg cursor-pointer" onClick={() => go('sleep')}>
                Edit
              </button>
            }
          >
            <div className="flex items-baseline gap-2">
              <span
                className={`num text-[31px] leading-none font-medium ${
                  day.sleep?.sleepAt && day.sleep?.wakeAt
                    ? day.sleepOnTarget
                      ? 'text-done'
                      : ''
                    : 'text-faint'
                }`}
              >
                {day.sleep?.sleepAt && day.sleep?.wakeAt
                  ? formatHoursMinutes(
                      Math.round((day.sleep.wakeAt - day.sleep.sleepAt) / 60_000)
                    )
                  : '—'}
              </span>
            </div>
            <dl className="mt-4 space-y-2">
              <SleepRow label="Slept" value={formatClock(day.sleep?.sleepAt, tz)} />
              <SleepRow label="Woke" value={formatClock(day.sleep?.wakeAt, tz)} />
              <SleepRow
                label="Target"
                value={`${settings.targetBedtime}–${settings.targetWakeTime}`}
              />
              <SleepRow
                label="Verdict"
                value={day.sleepOnTarget ? 'On target' : 'Off target'}
                tone={day.sleepOnTarget ? 'text-done' : 'text-dim'}
              />
            </dl>
          </Panel>

          <Panel title="Note" right={<span className="micro">Editable on any day</span>}>
            <textarea
              rows={7}
              value={note}
              maxLength={2000}
              placeholder="Anything worth remembering about this day."
              onChange={(e) => setNote(e.target.value)}
              className="resize-none"
            />
            <div className="flex justify-end mt-3">
              <Button size="sm" onClick={saveNote} disabled={note === savedNote}>
                {note === savedNote ? 'Saved' : 'Save note'}
              </Button>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}

function SleepRow({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone?: string
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="micro">{label}</dt>
      <dd className={`num text-[12px] ${tone ?? ''}`}>{value}</dd>
    </div>
  )
}
