/**
 * The wire to the sync server.
 *
 * Nothing here decides anything — it moves change sets and turns failures into
 * a typed result. Kept apart from `syncService` so the cycle can be tested with
 * a fake in place of the network.
 */
import type { ChangeSet, SyncRows } from '@shared/sync'
import type { Account } from '../db/account'

export interface PushOutcome {
  accepted: number
  skipped: number
  rejected: Array<{ table: string; key: string; reason: string }>
  seq: number
}

export type PullOutcome = ChangeSet & { more: boolean }

export interface SyncTransport {
  pull(since: number): Promise<PullOutcome>
  push(rows: SyncRows): Promise<PushOutcome>
}

/**
 * Raised when the server says the session is no longer good.
 *
 * Separated from every other failure because it is the one the user has to act
 * on: retrying will never fix it, and the app should stop pretending to sync.
 */
export class SessionExpired extends Error {
  constructor() {
    super('signed out by the server')
    this.name = 'SessionExpired'
  }
}

/** How long a single request may take before it is abandoned. */
const TIMEOUT_MS = 20_000

export function httpTransport(account: Account, fetchImpl = fetch): SyncTransport {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    let response: Response
    try {
      response = await fetchImpl(`${account.server}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...init?.headers,
          Authorization: `Bearer ${account.token}`,
          'Content-Type': 'application/json'
        }
      })
    } catch (err) {
      // A timeout and an unreachable host are the same thing to the caller:
      // the device is offline for now, and the cycle will be retried.
      throw new Error(err instanceof Error ? err.message : 'could not reach the server')
    } finally {
      clearTimeout(timer)
    }

    if (response.status === 401) throw new SessionExpired()
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`server returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`)
    }
    return (await response.json()) as T
  }

  return {
    pull: (since) => call<PullOutcome>(`/changes?since=${since}`),
    push: (rows) =>
      call<PushOutcome>('/changes', { method: 'POST', body: JSON.stringify({ rows }) })
  }
}
