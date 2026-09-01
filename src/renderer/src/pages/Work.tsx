/**
 * Work — the stopwatch is the focal point.
 *
 * Name the session beside it, then start. While running, the panel takes the
 * accent top rule and the primary button inverts, so the accent never does two
 * jobs at once. Stopping writes a row into today's log, editable after the fact.
 */
import { useEffect, useState } from 'react'
import type { WorkSession } from '@shared/types'
import { formatClock, formatSecondsAsHours, formatStopwatch } from '@shared/format'
import { api } from '../lib/api'
import { useAction, useAsync, useNow, usePersistedState } from '../lib/hooks'
import { Button, Empty, Modal, Note, Panel, StatTile } from '../components/ui'

export default function WorkPage(): React.JSX.Element {
  const now = useNow(1000)
  const [unit, setUnit] = usePersistedState<'week' | 'month'>('work.unit', 'week')
  const { data: settings } = useAsync(() => api.getSettings(), [])
  const { data: today } = useAsync(() => api.currentDate(), [])
  const { data: totals, reload } = useAsync(() => api.getWorkTotals(), [])
  const { data: sessions } = useAsync(
    () => (today ? api.listWorkForDate(today) : Promise.resolve([])),
    [today]
  )
  const { data: buckets } = useAsync(() => api.getWorkBuckets(unit, 12), [unit])
  const { data: projects } = useAsync(() => api.listProjects(), [])
  const action = useAction()

  const [project, setProject] = useState('')
  const [stopNote, setStopNote] = useState('')
  const [editing, setEditing] = useState<WorkSession | null>(null)

  const tz = settings?.timezone ?? 'UTC'
  const running = totals?.running ?? null
  const run = (fn: () => Promise<unknown>): void => {
    void action.run(fn).then(() => reload())
  }

  const start = (): void => {
    if (!project.trim()) return
    run(() => api.startWork(project))
    setProject('')
  }
  const stop = (): void => {
    run(() => api.stopWork(stopNote || null))
    setStopNote('')
  }

  // Autocomplete filtered by what has been typed so far.
  const matches = (projects ?? [])
    .filter((p) => project.trim() && p.toLowerCase().includes(project.trim().toLowerCase()))
    .slice(0, 5)

  const totalsRows = (buckets ?? [])
    .flatMap((b) => b.byProject)
    .reduce<Map<string, number>>(
      (map, p) => map.set(p.project, (map.get(p.project) ?? 0) + p.seconds),
      new Map()
    )
  const ranked = [...totalsRows.entries()].sort((a, b) => b[1] - a[1])
  const rankTotal = ranked.reduce((s, [, v]) => s + v, 0)
  const peak = Math.max(1, ...(buckets ?? []).map((b) => b.seconds))

  return (
    <div className="pb-5">
      <div className="h-11 px-[18px] border-b border-line flex items-center justify-between gap-4 bg-panel">
        <span className="label">Focused work</span>
        <span className="micro">{running ? 'Session running' : 'No session running'}</span>
      </div>

      {action.error && (
        <div className="px-[18px] pt-3">
          <Note tone={action.error.isGuard ? 'info' : 'warn'}>{action.error.message}</Note>
        </div>
      )}

      <div className="px-[18px] pt-4">
        <Panel live={running != null} pad={false}>
          <div className="flex flex-col lg:flex-row">
            <div className="px-6 py-6 lg:w-[440px] shrink-0 lg:border-r border-line">
              <div className="micro">{running ? running.project : 'Stopwatch'}</div>
              <div
                className={`num text-[82px] leading-none font-medium tracking-[-0.03em] mt-2
                  ${running ? 'text-accent' : 'text-faint'}`}
              >
                {running ? formatStopwatch(now - running.startedAt) : '0:00'}
              </div>
              {running && (
                <div className="micro mt-3">Started {formatClock(running.startedAt, tz)}</div>
              )}
            </div>

            <div className="flex-1 min-w-0 px-6 py-6 flex flex-col justify-center gap-3">
              {running ? (
                <>
                  <label className="block">
                    <span className="micro block mb-1.5">What got done? (optional)</span>
                    <input
                      type="text"
                      value={stopNote}
                      maxLength={160}
                      placeholder="One line is enough"
                      onChange={(e) => setStopNote(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && stop()}
                    />
                  </label>
                  <Button size="lg" onClick={stop} className="self-start">
                    Stop session
                  </Button>
                </>
              ) : (
                <>
                  <label className="block relative">
                    <span className="micro block mb-1.5">Name the session</span>
                    <input
                      type="text"
                      value={project}
                      placeholder="What are you working on?"
                      onChange={(e) => setProject(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && start()}
                    />
                    {matches.length > 0 && (
                      <div className="absolute left-0 right-0 top-full z-10 border border-line-strong bg-panel-2">
                        {matches.map((p) => {
                          const lifetime = totalsRows.get(p) ?? 0
                          return (
                            <button
                              key={p}
                              type="button"
                              onClick={() => setProject(p)}
                              className="w-full flex items-center justify-between gap-3 px-3 h-8
                                text-left text-[12px] hover:bg-panel cursor-pointer"
                            >
                              <span className="truncate">{p}</span>
                              <span className="num text-[11px] text-faint">
                                {formatSecondsAsHours(lifetime)}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </label>
                  <Button
                    size="lg"
                    variant="primary"
                    onClick={start}
                    disabled={!project.trim()}
                    className="self-start"
                  >
                    Start work
                  </Button>
                </>
              )}
            </div>
          </div>
        </Panel>
      </div>

      <div className="px-[18px] pt-2.5">
        <div className="flex border border-line bg-panel">
          <StatTile
            label="Today"
            value={totals && totals.todaySeconds ? formatSecondsAsHours(totals.todaySeconds) : null}
          />
          <StatTile
            label="This week"
            value={totals && totals.weekSeconds ? formatSecondsAsHours(totals.weekSeconds) : null}
          />
          <StatTile label="Projects" value={ranked.length || null} />
          <StatTile
            label={`Last 12 ${unit}s`}
            value={rankTotal ? Math.round((rankTotal / 3600) * 10) / 10 : null}
            unit="h"
          />
        </div>
      </div>

      <div className="px-[18px] pt-2.5 grid grid-cols-1 lg:grid-cols-2 gap-2.5 items-start">
        <Panel
          title="Today's log"
          pad={false}
          right={
            <span className="num text-[11px] text-faint">
              {totals?.todaySeconds ? formatSecondsAsHours(totals.todaySeconds) : '—'}
            </span>
          }
        >
          {(sessions ?? []).length === 0 ? (
            <Empty>Nothing logged yet today. Name a session above and start the clock.</Empty>
          ) : (
            <ul>
              {(sessions ?? []).map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 px-4 py-2 border-b border-line last:border-b-0 hover:bg-panel-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{s.project}</div>
                    <div className="micro mt-0.5">
                      {formatClock(s.startedAt, tz)} →{' '}
                      {s.endedAt ? formatClock(s.endedAt, tz) : 'running'}
                      {s.note ? ` · ${s.note}` : ''}
                    </div>
                  </div>
                  <span className="num text-[12px] text-dim">
                    {formatStopwatch(s.durationSec * 1000)}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                    Edit
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title={`Totals per ${unit}`}
          pad={false}
          right={
            <span className="flex gap-1">
              <Button
                size="sm"
                variant={unit === 'week' ? 'default' : 'ghost'}
                onClick={() => setUnit('week')}
              >
                Weekly
              </Button>
              <Button
                size="sm"
                variant={unit === 'month' ? 'default' : 'ghost'}
                onClick={() => setUnit('month')}
              >
                Monthly
              </Button>
            </span>
          }
        >
          <div className="p-[18px]">
            {(buckets ?? []).every((b) => b.seconds === 0) ? (
              <Empty>No sessions in this range.</Empty>
            ) : (
              <div className="flex items-end gap-1.5 h-[132px]">
                {(buckets ?? []).map((b) => (
                  <div key={b.bucket} className="flex-1 min-w-0 flex flex-col justify-end h-full">
                    <div className="flex-1 flex items-end bg-wait">
                      <div
                        className="w-full bg-accent"
                        style={{ height: `${(b.seconds / peak) * 100}%` }}
                        title={`${b.bucket}: ${formatSecondsAsHours(b.seconds)}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* Labels sit outside the measured track, or flexbox steals their height. */}
            <div className="flex gap-1.5 mt-1.5">
              {(buckets ?? []).map((b) => (
                <span key={b.bucket} className="flex-1 min-w-0 micro text-center truncate">
                  {unit === 'week' ? b.bucket.slice(5) : b.bucket.slice(2)}
                </span>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <div className="px-[18px] pt-2.5">
        <Panel title="Hours per project" right={<span className="micro">Last 12 {unit}s</span>}>
          {ranked.length === 0 ? (
            <Empty>No sessions recorded.</Empty>
          ) : (
            <div className="space-y-2.5">
              {ranked.map(([name, seconds]) => (
                <div key={name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-4 items-center">
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] mb-1.5">{name}</div>
                    <div className="h-1.5 bg-wait">
                      <div
                        className="h-full bg-accent"
                        style={{ width: `${(seconds / ranked[0][1]) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span className="num text-[12px] text-dim w-16 text-right">
                    {formatSecondsAsHours(seconds)}
                  </span>
                  <span className="num text-[11px] text-faint w-10 text-right">
                    {Math.round((seconds / rankTotal) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <EditSessionModal
        session={editing}
        tz={tz}
        onClose={() => setEditing(null)}
        onSaved={reload}
      />
    </div>
  )
}

/** Corrects a session after the fact — times here are entered, not measured. */
function EditSessionModal({
  session,
  tz,
  onClose,
  onSaved
}: {
  session: WorkSession | null
  tz: string
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element | null {
  const action = useAction()
  const [project, setProject] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!session) return
    setProject(session.project)
    setStart(formatClock(session.startedAt, tz))
    setEnd(session.endedAt ? formatClock(session.endedAt, tz) : '')
    setNote(session.note ?? '')
  }, [session?.id, tz])

  if (!session) return null

  /** Re-anchors an HH:MM edit onto the session's own calendar day. */
  const withClock = (base: number, hhmm: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
    if (!m) return null
    const d = new Date(base)
    d.setHours(Number(m[1]), Number(m[2]), 0, 0)
    return d.getTime()
  }

  const save = (): void => {
    void action
      .run(() =>
        api.updateWorkSession(session.id, {
          project,
          startedAt: withClock(session.startedAt, start) ?? session.startedAt,
          endedAt: end.trim() ? withClock(session.endedAt ?? session.startedAt, end) : null,
          note: note || null
        })
      )
      .then((ok) => {
        if (ok) {
          onSaved()
          onClose()
        }
      })
  }

  return (
    <Modal open title="Edit session" onClose={onClose}>
      <div className="space-y-3.5">
        <label className="block">
          <span className="micro block mb-1.5">Project</span>
          <input type="text" value={project} onChange={(e) => setProject(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3.5">
          <label className="block">
            <span className="micro block mb-1.5">Started</span>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="block">
            <span className="micro block mb-1.5">Ended</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className="micro block mb-1.5">Note</span>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {action.error && <Note tone="warn">{action.error.message}</Note>}
        <div className="flex justify-between gap-2">
          <Button
            variant="danger"
            onClick={() =>
              void action.run(() => api.deleteWorkSession(session.id)).then(() => {
                onSaved()
                onClose()
              })
            }
          >
            Delete
          </Button>
          <span className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save}>
              Save
            </Button>
          </span>
        </div>
      </div>
    </Modal>
  )
}
