import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { DateStr } from '@shared/types'

export type RouteName =
  | 'home'
  | 'calendar'
  | 'week'
  | 'day'
  | 'work'
  | 'sleep'
  | 'stats'
  | 'review'
  | 'lists'
  | 'settings'

export interface Route {
  name: RouteName
  /** The day a detail or week view is anchored on. */
  date?: DateStr
}

interface NavValue {
  route: Route
  go: (name: RouteName, date?: DateStr) => void
  back: () => void
  canGoBack: boolean
}

const NavContext = createContext<NavValue | null>(null)

export function NavProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }])

  const value = useMemo<NavValue>(
    () => ({
      route: stack[stack.length - 1],
      go: (name, date) =>
        setStack((s) => {
          const next = { name, date }
          const current = s[s.length - 1]
          // Re-selecting the same view replaces rather than stacking, so Back
          // never has to walk through a run of identical screens.
          if (current.name === name && current.date === date) return s
          return [...s.slice(-19), next]
        }),
      back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
      canGoBack: stack.length > 1
    }),
    [stack]
  )

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>
}

export function useNav(): NavValue {
  const ctx = useContext(NavContext)
  if (!ctx) throw new Error('useNav must be used inside NavProvider')
  return ctx
}
