import { useEffect, useState } from 'react'
import type { Settings, WorkSession } from '@shared/types'
import { isoWeekNumber, zoneLabel } from '@shared/time'
import { formatClock, formatDateShort, formatSecondsAsHours } from '@shared/format'
import { api } from './lib/api'
import { useAppEvent, useAsync, useNow } from './lib/hooks'
import { NavProvider, useNav, type RouteName } from './lib/nav'
import { Button, Modal, Note } from './components/ui'
import HomePage from './pages/Home'
import CalendarPage from './pages/Calendar'
import WeekPage from './pages/Week'
import DayDetailPage from './pages/DayDetail'
import WorkPage from './pages/Work'
import SleepPage from './pages/Sleep'
import StatsPage from './pages/Stats'
import ReviewPage from './pages/Review'
import ListsPage from './pages/Lists'
import SettingsPage from './pages/Settings'

interface NavItem {
  name: RouteName
  label: string
  key: string
}

/** Three labelled groups: what is happening now, what already happened, and setup. */
const NAV_GROUPS: Array<{ group: string; items: NavItem[] }> = [
  { group: 'Now', items: [{ name: 'home', label: 'Today', key: '1' }] },
  {
    group: 'History',
    items: [
      { name: 'calendar', label: 'Calendar', key: '2' },
      { name: 'week', label: 'Week', key: '3' },
      { name: 'work', label: 'Work', key: '4' },
      { name: 'sleep', label: 'Sleep', key: '5' },
      { name: 'stats', label: 'Stats', key: '6' },
      { name: 'review', label: 'Review', key: '7' }
    ]
  },
  {
    group: 'Setup',
    items: [
      { name: 'lists', label: 'Lists', key: '8' },
      { name: 'settings', label: 'Settings', key: '9' }
    ]
  }
]

const ALL_NAV = NAV_GROUPS.flatMap((g) => g.items)

function Sidebar(): React.JSX.Element {
  const now = useNow(1000)
  const { route, go } = useNav()
  const { data: due } = useAsync(() => api.isReviewDue(), [])
  const { data: today } = useAsync(() => api.currentDate(), [])
  const { data: settings } = useAsync(() => api.getSettings(), [])
  const { data: day } = useAsync(() => (today ? api.getDay(today) : Promise.resolve(null)), [today])
  const { data: totals } = useAsync(() => api.getWorkTotals(), [])

  const tz = settings?.timezone ?? 'UTC'

  // The meta figure each item carries, so the sidebar reports as well as navigates.
  const meta: Partial<Record<RouteName, string>> = {
    home: day ? String(day.score.total) : '—',
    week: today ? `W${isoWeekNumber(today)}` : '—',
    work: totals ? formatSecondsAsHours(totals.todaySeconds) : '—'
  }

  return (
    <nav className="w-[188px] shrink-0 border-r border-line bg-panel flex flex-col">
      <div className="px-[18px] pt-4 pb-3.5 border-b border-line select-none">
        <div className="num text-accent font-bold tracking-[0.2em] text-[14px]">BETTER</div>
        <div className="micro mt-1">Local · Offline</div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {NAV_GROUPS.map(({ group, items }) => (
          <div key={group} className="mb-1">
            <div className="micro px-[18px] py-2">{group}</div>
            <ul>
              {items.map((item) => {
                const active =
                  route.name === item.name || (item.name === 'calendar' && route.name === 'day')
                return (
                  <li key={item.name}>
                    <button
                      type="button"
                      onClick={() => go(item.name)}
                      title={`${item.label}  (Alt+${item.key})`}
                      className={`w-full h-8 px-[18px] flex items-center justify-between gap-2
                        border-l-2 cursor-pointer transition-colors text-[12.5px]
                        ${
                          active
                            ? 'bg-panel-2 border-l-accent text-fg font-semibold'
                            : 'border-l-transparent text-dim hover:text-fg hover:bg-panel-2'
                        }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        {item.label}
                        {item.name === 'review' && due && (
                          <span className="w-1.5 h-1.5 bg-accent" title="Review ready" />
                        )}
                      </span>
                      <span className={`num text-[11px] ${active ? 'text-accent' : 'text-faint'}`}>
                        {meta[item.name] ?? ''}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="px-[18px] py-3.5 border-t border-line">
        <div className="micro">{today ? formatDateShort(today) : ''}</div>
        <div className="num text-[22px] leading-tight mt-0.5">{formatClock(now, tz)}</div>
        <div className="micro mt-0.5">{zoneLabel(tz, now)}</div>
      </div>
    </nav>
  )
}

/** The footer status bar: where the data lives, and what it is doing. */
function StatusBar(): React.JSX.Element {
  const { data: info } = useAsync(() => api.getInfo(), [])
  const [saved, setSaved] = useState(false)
  useAppEvent('data:changed', () => setSaved(true))

  // The tail of the real path, rather than a decorative one.
  const path = info?.dbPath ? info.dbPath.split(/[\\/]/).slice(-2).join('/') : '—'

  return (
    <footer className="shrink-0 border-t border-line">
      <div className="h-6 px-[18px] flex items-center justify-between gap-4 text-[10.5px] font-mono text-faint">
        <span className="truncate" title={info?.dbPath}>
          {path}
          <span className="mx-2 opacity-50">·</span>
          {saved ? 'SAVED' : 'IDLE'}
        </span>
        <span className="hidden md:flex gap-4 shrink-0">
          <span>ALT+1…9 VIEWS</span>
          <span>CTRL+SHIFT+H TOGGLE</span>
        </span>
      </div>
    </footer>
  )
}

/** Asks about a session that has been running suspiciously long. */
function LongSessionPrompt(): React.JSX.Element | null {
  const [session, setSession] = useState<WorkSession | null>(null)
  useAppEvent('work:long-session', (payload) => setSession(payload as WorkSession))

  const resolve = async (action: 'keep' | 'stop' | 'discard'): Promise<void> => {
    await api.resolveLongSession(action)
    setSession(null)
  }

  if (!session) return null
  const hours = Math.floor(session.durationSec / 3600)
  return (
    <Modal open title="Session still running" onClose={() => setSession(null)}>
      <p className="text-dim mb-4">
        <span className="text-fg">{session.project}</span> has been running for{' '}
        <span className="num text-fg">{hours}h</span>. Still working, or was it left on?
      </p>
      <div className="flex gap-2 justify-end">
        <Button onClick={() => void resolve('discard')} variant="danger">
          Discard it
        </Button>
        <Button onClick={() => void resolve('stop')}>Stop now</Button>
        <Button onClick={() => void resolve('keep')} variant="primary">
          Still working
        </Button>
      </div>
    </Modal>
  )
}

function ReviewBanner(): React.JSX.Element | null {
  const { route, go } = useNav()
  const [dismissed, setDismissed] = useState(false)
  const { data: due, reload } = useAsync(() => api.isReviewDue(), [])
  useAppEvent('review:due', () => {
    setDismissed(false)
    reload()
  })

  if (!due || dismissed || route.name === 'review') return null
  return (
    <div className="px-[18px] py-2.5 border-b border-line bg-panel-2 border-l-2 border-l-accent flex items-center justify-between gap-4">
      <span className="text-[12.5px]">The week is complete. The review is ready when you are.</span>
      <span className="flex gap-2 shrink-0">
        <Button size="sm" variant="ghost" onClick={() => go('review')}>
          Open review
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
          Later
        </Button>
      </span>
    </div>
  )
}

function Routes(): React.JSX.Element {
  const { route } = useNav()
  switch (route.name) {
    case 'home':
      return <HomePage />
    case 'calendar':
      return <CalendarPage />
    case 'week':
      return <WeekPage />
    case 'day':
      return <DayDetailPage date={route.date!} />
    case 'work':
      return <WorkPage />
    case 'sleep':
      return <SleepPage />
    case 'stats':
      return <StatsPage />
    case 'review':
      return <ReviewPage />
    case 'lists':
      return <ListsPage />
    case 'settings':
      return <SettingsPage />
    default:
      return <HomePage />
  }
}

function Shell(): React.JSX.Element {
  const { go } = useNav()

  // The tray menu and the main process can both drive navigation.
  useAppEvent('navigate', (payload) => {
    if (typeof payload === 'string') go(payload as RouteName)
  })

  // Alt+<n> jumps between views without leaving the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return
      const item = ALL_NAV.find((n) => n.key === e.key)
      if (item) {
        e.preventDefault()
        go(item.name)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  return (
    <div className="h-full flex bg-bg text-fg">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col">
        <ReviewBanner />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <Routes />
        </div>
        <StatusBar />
      </main>
      <LongSessionPrompt />
    </div>
  )
}

export default function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch((err: Error) => setFailed(err.message))
  }, [])

  // The theme lives on <html> so the CSS variables cascade to everything.
  useEffect(() => {
    if (settings) document.documentElement.dataset.theme = settings.theme
  }, [settings])

  useAppEvent('data:changed', () => {
    api
      .getSettings()
      .then(setSettings)
      .catch(() => undefined)
  })

  if (failed) {
    return (
      <div className="h-full grid place-items-center p-8">
        <Note tone="warn">Could not reach the local database: {failed}</Note>
      </div>
    )
  }
  if (!settings) return <div className="h-full bg-bg" />

  return (
    <NavProvider>
      <Shell />
    </NavProvider>
  )
}
