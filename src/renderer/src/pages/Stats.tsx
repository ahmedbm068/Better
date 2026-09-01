/** Stats: prayer rate over time, score trend, habit heatmap, clean-day totals. */
import { weekdayOf } from '@shared/time'
import { formatDateShort, formatSecondsAsHours } from '@shared/format'
import { api } from '../lib/api'
import { useAsync, usePersistedState } from '../lib/hooks'
import { Button, Empty, Panel, StreakBadge } from '../components/ui'
import { BarChart, Heatmap, LineChart } from '../components/charts'

const RANGES = [30, 90, 180, 365]

export default function StatsPage(): React.JSX.Element {
  const [days, setDays] = usePersistedState<number>('stats.range', 90)
  const { data: stats, loading } = useAsync(() => api.getStats(days), [days])

  if (!stats) {
    return <div className="p-5 text-faint text-[12px]">{loading ? 'Loading…' : 'No data yet.'}</div>
  }

  const { totals } = stats
  const prayerPct = totals.prayersPossible
    ? Math.round((totals.prayersDone / totals.prayersPossible) * 100)
    : 0

  return (
    <div className="p-6 max-w-[1240px] mx-auto space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="label">Stats</div>
          <h1 className="text-2xl mt-1 num tracking-tight">
            {formatDateShort(stats.from)} – {formatDateShort(stats.to)}
          </h1>
        </div>
        <div className="flex gap-1">
          {RANGES.map((n) => (
            <Button
              key={n}
              size="sm"
              variant={days === n ? 'default' : 'ghost'}
              onClick={() => setDays(n)}
            >
              {n}d
            </Button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-5">
        <Panel>
          <div className="label mb-1">Average score</div>
          <div className="num text-2xl">{totals.avgScore}</div>
        </Panel>
        <Panel>
          <div className="label mb-1">Prayer rate</div>
          <div className="num text-2xl">{prayerPct}%</div>
          <div className="num text-[11px] text-faint mt-1">
            {totals.prayersDone}/{totals.prayersPossible}
          </div>
        </Panel>
        <Panel>
          <div className="label mb-1">5/5 streak</div>
          <div className="num text-2xl text-accent">{stats.fiveOfFive.current}</div>
          <div className="num text-[11px] text-faint mt-1">record {stats.fiveOfFive.record}</div>
        </Panel>
        <Panel>
          <div className="label mb-1">Focused</div>
          <div className="num text-2xl">{totals.focusedHours}h</div>
        </Panel>
        <Panel>
          <div className="label mb-1">Days tracked</div>
          <div className="num text-2xl">{totals.daysTracked}</div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Panel title="Score trend">
          <LineChart
            points={stats.series.map((p) => ({ label: p.date.slice(5), value: p.score }))}
            min={0}
            max={100}
            yTicks={[0, 25, 50, 75, 100]}
            height={160}
          />
        </Panel>

        <Panel title="Prayer completion, by week">
          <LineChart
            points={stats.prayerRate.map((p) => ({
              label: p.bucket.slice(5),
              value: Math.round(p.rate * 100)
            }))}
            min={0}
            max={100}
            yTicks={[0, 50, 100]}
            formatY={(v) => `${v}%`}
            color="var(--done)"
            height={160}
          />
        </Panel>
      </div>

      <Panel title="Habit heatmap" right={<span className="label">last 26 weeks</span>}>
        <Heatmap cells={stats.heatmap} weekdayOf={weekdayOf} />
        <div className="flex items-center gap-2 mt-3 text-[11px] text-faint">
          <span>none</span>
          {[0, 0.3, 0.6, 0.85, 1].map((v) => (
            <span
              key={v}
              className="w-[11px] h-[11px] "
              style={{
                background:
                  v === 0
                    ? 'var(--wait)'
                    : `color-mix(in srgb, var(--accent) ${Math.round(v * 100)}%, var(--wait))`
              }}
            />
          ))}
          <span>all</span>
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <Panel title="Habits">
          {stats.habits.length === 0 ? (
            <Empty>No habits tracked.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {stats.habits.map((h) => (
                <li key={h.id} className="py-2 flex items-center gap-3">
                  <span className="flex-1 truncate">{h.name}</span>
                  <span className="num text-dim w-[74px] text-right">
                    {h.completions}/{h.applicableDays}
                  </span>
                  <span className="num text-dim w-[44px] text-right">
                    {Math.round(h.rate * 100)}%
                  </span>
                  <StreakBadge current={h.streak.current} record={h.streak.record} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Clean days per avoid item">
          {stats.avoid.length === 0 ? (
            <Empty>Nothing on the avoid list.</Empty>
          ) : (
            <>
              <BarChart
                height={150}
                bars={stats.avoid.map((a) => ({
                  label: a.name.replace(/^No /i, '').slice(0, 8),
                  value: a.cleanDays,
                  title: `${a.name}: ${a.cleanDays} clean, ${a.slipDays} with a slip`
                }))}
                formatY={(v) => String(Math.round(v))}
              />
              <ul className="divide-y divide-line text-[12px] mt-2">
                {stats.avoid.map((a) => (
                  <li key={a.id} className="py-2 flex items-center gap-3">
                    <span className="flex-1 truncate">{a.name}</span>
                    <span className="num text-done w-[70px] text-right">{a.cleanDays} clean</span>
                    <span className="num text-missed w-[62px] text-right">{a.slipDays} slips</span>
                    <StreakBadge current={a.streak.current} record={a.streak.record} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>

      <Panel title="Focused hours per day">
        <BarChart
          height={140}
          bars={stats.series.map((p) => ({
            label: p.date.slice(5),
            value: Math.round((p.workSeconds / 3600) * 10) / 10,
            title: `${p.date}: ${formatSecondsAsHours(p.workSeconds)}`
          }))}
          formatY={(v) => `${Math.round(v)}h`}
        />
      </Panel>
    </div>
  )
}
