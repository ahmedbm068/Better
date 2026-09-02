import { useEffect, useState, type ReactNode } from 'react'
import type { Settings, Theme, WorkSession } from '@shared/types'
import { isoWeekNumber, zoneLabel } from '@shared/time'
import { daylightAt, sunTimesFromPrayers, themePosition } from '@shared/daylight'
import { formatClock, formatDateShort, formatSecondsAsHours } from '@shared/format'
import { api } from './lib/api'
import { useAppEvent, useAsync, useNow } from './lib/hooks'
import { NavProvider, useNav, type RouteName } from './lib/nav'
import { Button, Modal, Note } from './components/ui'
import { QuoteIntro } from './components/quote'
import {
  IconCalendar,
  IconLists,
  IconReview,
  IconSettings,
  IconSleep,
  IconStats,
  IconToday,
  IconWeek,
  IconWork,
  Logo,
  type IconProps
} from './components/icons'
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
import SignInPage from './pages/SignIn'
import type { SyncStatus } from '@shared/api'

interface NavItem {
  name: RouteName
  label: string
  key: string
  icon: (p: IconProps) => React.JSX.Element
}

/**
 * Three groups: what is happening now, what already happened, and setup.
 *
 * The groups used to carry printed headings. The icons and the rules between
 * them do that job now, which is three fewer lines of text on every screen.
 */
const NAV_GROUPS: NavItem[][] = [
  [{ name: 'home', label: 'Today', key: '1', icon: IconToday }],
  [
    { name: 'calendar', label: 'Calendar', key: '2', icon: IconCalendar },
    { name: 'week', label: 'Week', key: '3', icon: IconWeek },
    { name: 'work', label: 'Work', key: '4', icon: IconWork },
    { name: 'sleep', label: 'Sleep', key: '5', icon: IconSleep },
    { name: 'stats', label: 'Stats', key: '6', icon: IconStats },
    { name: 'review', label: 'Review', key: '7', icon: IconReview }
  ],
  [
    { name: 'lists', label: 'Lists', key: '8', icon: IconLists },
    { name: 'settings', label: 'Settings', key: '9', icon: IconSettings }
  ]
]

const ALL_NAV = NAV_GROUPS.flat()

function Sidebar(): React.JSX.Element {
  const now = useNow(1000)
  const { route, go } = useNav()
  const { data: due } = useAsync(() => api.isReviewDue(), [])
  const { data: today } = useAsync(() => api.currentDate(), [])
  const { data: settings } = useAsync(() => api.getSettings(), [])
  const { data: day } = useAsync(() => (today ? api.getDay(today) : Promise.resolve(null)), [today])
  const { data: totals } = useAsync(() => api.getWorkTotals(), [])
  const { data: sync, reload: reloadSync } = useAsync(() => api.syncStatus(), [])

  useAppEvent('sync:changed', reloadSync)

  const tz = settings?.timezone ?? 'UTC'

  // The meta figure each item carries, so the sidebar reports as well as navigates.
  const meta: Partial<Record<RouteName, string>> = {
    home: day ? String(day.score.total) : '',
    week: today ? `W${isoWeekNumber(today)}` : '',
    work: totals && totals.todaySeconds > 0 ? formatSecondsAsHours(totals.todaySeconds) : ''
  }

  return (
    <nav className="w-[210px] shrink-0 border-r border-line bg-panel flex flex-col">
      <div className="px-4 pt-4 pb-3.5 select-none">
        <div className="flex items-center gap-2.5">
          <Logo size={24} className="text-fg" />
          <span className="text-[16px] font-semibold tracking-[-0.01em]">Better</span>
        </div>
        {/* Said what it was, always. Now it says what it is. */}
        <div className="flex items-center gap-1.5 mt-2 pl-0.5" title={sync?.email ?? undefined}>
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              sync?.signedIn ? (sync.pending ? 'bg-accent' : 'bg-done') : 'bg-line-strong'
            }`}
          />
          <span className="micro truncate">
            {sync?.signedIn ? (sync.pending ? 'Syncing' : 'Synced') : 'Offline'}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {NAV_GROUPS.map((items, i) => (
          <ul key={i} className={i > 0 ? 'mt-2 pt-2 border-t border-line' : ''}>
            {items.map((item) => {
              const active =
                route.name === item.name || (item.name === 'calendar' && route.name === 'day')
              const Icon = item.icon
              return (
                <li key={item.name}>
                  <button
                    type="button"
                    onClick={() => go(item.name)}
                    title={`${item.label}  (Alt+${item.key})`}
                    className={`w-full h-9 px-2.5 mb-0.5 rounded-lg flex items-center gap-2.5
                      cursor-pointer transition-colors text-[13px]
                      ${
                        active
                          ? 'bg-accent-ghost text-accent font-medium'
                          : 'text-dim hover:text-fg hover:bg-panel-2'
                      }`}
                  >
                    <Icon size={17} className="shrink-0" />
                    <span className="truncate flex-1 text-left">{item.label}</span>
                    {item.name === 'review' && due && (
                      <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" title="Review ready" />
                    )}
                    {meta[item.name] && (
                      <span className={`num text-[11px] ${active ? 'text-accent' : 'text-faint'}`}>
                        {meta[item.name]}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        ))}
      </div>

      <div className="px-4 py-3.5 border-t border-line">
        <div className="num text-[22px] leading-tight">{formatClock(now, tz)}</div>
        <div className="micro mt-0.5 truncate">
          {today ? formatDateShort(today) : ''} · {zoneLabel(tz, now)}
        </div>
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
      <div
        className="h-7 px-4 flex items-center gap-2 text-[11px] text-faint"
        title="Alt+1…9 switches view · Ctrl+Shift+H toggles the window"
      >
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
            saved ? 'bg-done' : 'bg-line-strong'
          }`}
        />
        <span className="truncate font-mono" title={info?.dbPath}>
          {path}
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
    <div className="mx-6 mt-4 -mb-1 px-4 py-2.5 rounded-lg bg-accent-ghost
      flex items-center justify-between gap-4 fade-in">
      <span className="text-[13px]">The week is complete. Your review is ready.</span>
      <span className="flex gap-2 shrink-0">
        <Button size="sm" variant="primary" onClick={() => go('review')}>
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

/**
 * A view swap replays the entrance animation rather than cutting, so moving
 * between screens reads as one app rather than as a page load.
 */
function ViewTransition({ children }: { children: ReactNode }): React.JSX.Element {
  const { route } = useNav()
  return (
    <div key={`${route.name}:${route.date ?? ''}`} className="fade-in">
      {children}
    </div>
  )
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
          <ViewTransition>
            <Routes />
          </ViewTransition>
        </div>
        <StatusBar />
      </main>
      <LongSessionPrompt />
      <QuoteIntro />
    </div>
  )
}

/**
 * Puts the chosen theme on the document, and — in `solar` mode — keeps it
 * moving with the sun.
 *
 * The stylesheet does all of the colour work: everything here writes is one
 * number. `--daylight` runs 0 at night to 1 at midday and the whole palette is
 * a `color-mix` across it, so the ground eases from indigo to paper through
 * dawn and back again at dusk.
 *
 * The sun comes from the day's own prayer times, which are solar events already
 * computed for the user's coordinates. That means the theme and the day arc are
 * reading the same sky, and there is no second source of truth to drift.
 *
 * A minute is a fine resolution: across the slowest part of a transition the
 * palette moves by well under one per cent in that time.
 */
function useThemeMode(theme: Theme | undefined): void {
  const { data: today } = useAsync(() => api.currentDate(), [])
  const { data: day } = useAsync(
    () => (theme === 'solar' && today ? api.getDay(today) : Promise.resolve(null)),
    [theme, today]
  )
  const now = useNow(60_000)

  useEffect(() => {
    const root = document.documentElement
    if (!theme) return
    root.dataset.theme = theme

    // The fixed modes take their scalar from the stylesheet. Clearing the
    // inline values matters: they would otherwise outrank it forever.
    const sun = theme === 'solar' && day ? sunTimesFromPrayers(day.prayers) : null
    if (!sun) {
      root.style.removeProperty('--polarity')
      root.style.removeProperty('--warm')
      return
    }

    const { polarity, warm } = themePosition(daylightAt(now, sun))
    root.style.setProperty('--polarity', String(polarity))
    root.style.setProperty('--warm', warm.toFixed(4))
  }, [theme, day, now])
}

/** Remembers that someone chose to carry on without an account. */
const SKIPPED_KEY = 'better:no-account'

const hasSkipped = (): boolean => {
  try {
    return localStorage.getItem(SKIPPED_KEY) === '1'
  } catch {
    // A browser refusing storage is not a reason to block the app.
    return true
  }
}

export default function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [gate, setGate] = useState<{ web: boolean; status: SyncStatus } | null>(null)
  const [skipped, setSkipped] = useState(hasSkipped)

  // Called before any early return, so the sign-in gate is themed too.
  useThemeMode(settings?.theme)

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch((err: Error) => setFailed(err.message))
  }, [])

  // Only the web client is gated. The desktop app is offline-first, and asking
  // it to sign in before showing anything would break the promise it exists for.
  useEffect(() => {
    void Promise.all([api.getInfo(), api.syncStatus()])
      .then(([info, status]) => setGate({ web: info.platform === 'web', status }))
      .catch(() => setGate(null))
  }, [])

  useAppEvent('sync:changed', () => {
    void api.syncStatus().then((status) => {
      setGate((g) => (g ? { ...g, status } : g))
      if (status.signedIn) {
        // Clear the skip, so signing out later returns to the front door
        // rather than silently dropping into the local-only app.
        try {
          localStorage.removeItem(SKIPPED_KEY)
        } catch {
          // Nothing stored, nothing to clear.
        }
        setSkipped(false)
      }
    })
  })

  useAppEvent('data:changed', () => {
    api
      .getSettings()
      .then(setSettings)
      .catch(() => undefined)
  })

  if (gate?.web && !gate.status.signedIn && !skipped) {
    return (
      <SignInPage
        onSkip={() => {
          try {
            localStorage.setItem(SKIPPED_KEY, '1')
          } catch {
            // Nothing to remember it with; the choice lasts this visit only.
          }
          setSkipped(true)
        }}
      />
    )
  }

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
