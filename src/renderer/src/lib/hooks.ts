import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppEvent } from '@shared/api'
import { api, toFailure, type ApiFailure } from './api'

/** A ticking clock for countdowns. One interval, shared by whoever asks. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function useAppEvent(event: AppEvent, handler: (payload: unknown) => void): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => api.on(event, (payload) => ref.current(payload)), [event])
}

export interface AsyncState<T> {
  data: T | null
  error: ApiFailure | null
  loading: boolean
  reload: () => void
}

/**
 * Loads data and reloads it whenever the main process says something changed.
 * Stale responses from a superseded request are dropped rather than applied.
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiFailure | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const requestId = useRef(0)

  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    const id = ++requestId.current
    setLoading(true)
    loadRef
      .current()
      .then((result) => {
        if (id !== requestId.current) return
        setData(result)
        setError(null)
      })
      .catch((err) => {
        if (id !== requestId.current) return
        setError(toFailure(err))
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  useAppEvent('data:changed', reload)

  return { data, error, loading, reload }
}

/** Runs a mutation, surfacing any refusal as text instead of a crash. */
export function useAction(): {
  run: (fn: () => Promise<unknown>) => Promise<boolean>
  error: ApiFailure | null
  clear: () => void
  busy: boolean
} {
  const [error, setError] = useState<ApiFailure | null>(null)
  const [busy, setBusy] = useState(false)

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      setError(null)
      return true
    } catch (err) {
      setError(toFailure(err))
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  return { run, error, clear: () => setError(null), busy }
}

/** Local state that survives reloads, for small view preferences. */
export function usePersistedState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (next: T) => {
      setValue(next)
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // Storage being unavailable is not worth failing a render over.
      }
    },
    [key]
  )
  return [value, set]
}
