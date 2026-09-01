/**
 * The weekly review. Numbers first, then two boxes: what the week was, and the
 * one thing to fix next week. Saved reviews stay browsable.
 */
import { useEffect, useState } from 'react'
import { addDays, startOfWeek } from '@shared/time'
import { formatDateShort } from '@shared/format'
import { api } from '../lib/api'
import { useAction, useAsync } from '../lib/hooks'
import { useNav } from '../lib/nav'
import { Button, Empty, Meter, Note, Panel } from '../components/ui'
import { BarChart } from '../components/charts'

export default function ReviewPage(): React.JSX.Element {
  const { go } = useNav()
  const { data: defaultAnchor } = useAsync(() => api.getReviewAnchor(), [])
  const [anchor, setAnchor] = useState<string | null>(null)
  const week = anchor ?? defaultAnchor

  const { data: stats } = useAsync(
    () => (week ? api.getWeekStats(week) : Promise.resolve(null)),
    [week]
  )
  const { data: saved, reload } = useAsync(
    () => (week ? api.getReview(week) : Promise.resolve(null)),
    [week]
  )
  const { data: history } = useAsync(() => api.listReviews(), [])
  const action = useAction()

  const [note, setNote] = useState('')
  const [fixNext, setFixNext] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setNote(saved?.note ?? '')
    setFixNext(saved?.fixNext ?? '')
    setDirty(false)
  }, [saved?.weekStart, saved?.note, saved?.fixNext, week])

  if (!stats || !week) return <div className="p-6 text-faint">Loading…</div>

  const save = (): void => {
    void action.run(() => api.saveReview(week, note, fixNext)).then((ok) => {
      if (ok) {
        setDirty(false)
        reload()
      }
    })
  }

  return (
    <div className="p-6 max-w-[1240px] mx-auto space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="label">Weekly review</div>
          <h1 className="text-2xl mt-1 num tracking-tight">
            {formatDateShort(stats.weekStart)} – {formatDateShort(stats.weekEnd)}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setAnchor(addDays(startOfWeek(week), -7))}>
            ‹ Prev week
          </Button>
          <Button size="sm" onClick={() => setAnchor(defaultAnchor ?? null)}>
            Latest
          </Button>
          <Button size="sm" onClick={() => setAnchor(addDays(startOfWeek(week), 7))}>
            Next ›
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-5">
        <Panel>
          <div className="label mb-1">Average score</div>
          <div className="num text-2xl">{stats.avgScore}</div>
          <div className="mt-2">
            <Meter value={stats.avgScore} />
          </div>
        </Panel>
        <Panel>
          <div className="label mb-1">Prayer rate</div>
          <div className="num text-2xl">{Math.round(stats.prayerRate * 100)}%</div>
          <div className="num text-[11px] text-faint mt-1">
            {stats.prayersDone}/{stats.prayersPossible}
          </div>
        </Panel>
        <Panel>
          <div className="label mb-1">Focused</div>
          <div className="num text-2xl">{stats.focusedHours}h</div>
        </Panel>
        <Panel>
          <div className="label mb-1">Average sleep</div>
          <div className="num text-2xl">{stats.avgSleepHours}h</div>
        </Panel>
        <Panel>
          <div className="label mb-1">Best / worst day</div>
          <div className="num text-base">
            {stats.bestDay ? stats.bestDay.score : '—'}
            <span className="text-faint"> / </span>
            {stats.worstDay ? stats.worstDay.score : '—'}
          </div>
          <div className="num text-[11px] text-faint mt-1 truncate">
            {stats.bestDay ? formatDateShort(stats.bestDay.date) : ''}
            {stats.worstDay ? ` · ${formatDateShort(stats.worstDay.date)}` : ''}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <Panel title="Score by day">
          {stats.days.length === 0 ? (
            <Empty>Nothing recorded this week.</Empty>
          ) : (
            <BarChart
              height={150}
              max={100}
              bars={stats.days.map((d) => ({
                label: formatDateShort(d.date).slice(0, 3),
                value: d.score,
                title: `${formatDateShort(d.date)}: ${d.score}`
              }))}
              formatY={(v) => String(Math.round(v))}
              xLabels={7}
            />
          )}
        </Panel>

        <Panel title="Longest streaks">
          {stats.longestStreaks.length === 0 ? (
            <Empty>Nothing tracked yet.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {stats.longestStreaks.map((s) => (
                <li key={s.name} className="py-2 flex items-center gap-3">
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="num text-accent w-[38px] text-right">{s.current}</span>
                  <span className="num text-faint w-[62px] text-right">rec {s.record}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="This week"
        right={
          <span className="label">
            {saved ? `saved ${new Date(saved.updatedAt).toLocaleDateString()}` : 'not written yet'}
          </span>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <span className="label block mb-1">How the week went</span>
            <textarea
              rows={5}
              value={note}
              maxLength={2000}
              placeholder="A short, honest note."
              onChange={(e) => {
                setNote(e.target.value)
                setDirty(true)
              }}
              className="resize-none"
            />
          </div>
          <div>
            <span className="label block mb-1">One thing to fix next week</span>
            <textarea
              rows={5}
              value={fixNext}
              maxLength={500}
              placeholder="One. Not five."
              onChange={(e) => {
                setFixNext(e.target.value)
                setDirty(true)
              }}
              className="resize-none"
            />
          </div>
        </div>
        {action.error && (
          <div className="mt-2">
            <Note tone="warn">{action.error.message}</Note>
          </div>
        )}
        <div className="flex justify-end mt-3">
          <Button variant="primary" onClick={save} disabled={!dirty}>
            {dirty ? 'Save review' : 'Saved'}
          </Button>
        </div>
      </Panel>

      <Panel title="Past reviews" pad={false}>
        {(history ?? []).length === 0 ? (
          <Empty>No reviews written yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {(history ?? []).map((r) => (
              <li key={r.weekStart}>
                <button
                  onClick={() => setAnchor(r.weekStart)}
                  className={`w-full text-left px-3 py-2 hover:bg-panel-2 cursor-pointer
                    ${r.weekStart === week ? 'bg-panel-2' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="num text-dim w-[150px] shrink-0">
                      {formatDateShort(r.weekStart)} – {formatDateShort(addDays(r.weekStart, 6))}
                    </span>
                    <span className="flex-1 truncate">{r.note || '—'}</span>
                  </div>
                  {r.fixNext && (
                    <div className="text-[11px] text-accent mt-0.5 pl-[162px] truncate">
                      fix: {r.fixNext}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="text-[11px] text-faint">
        Looking for a single day?{' '}
        <button className="underline cursor-pointer" onClick={() => go('calendar')}>
          Open the calendar
        </button>
        .
      </div>
    </div>
  )
}
