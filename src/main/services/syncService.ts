/**
 * The sync cycle, and when to run it.
 *
 * Offline is the normal case, not a failure mode. Every write has already gone
 * to the local database by the time this runs; a cycle only moves what is
 * already recorded, so a device with no network is a device that is slightly
 * behind, never one that has lost anything.
 *
 * Push happens before pull, deliberately. Local work reaches the server before
 * this device takes anything that might supersede it, so a change made here is
 * never quietly overwritten by one it had not yet reported.
 */
import type { SyncRows } from '@shared/sync'
import { countRows } from '@shared/sync'
import { getAccount, recordFailure, recordSuccess, readStatus, clearAccount } from '../db/account'
import type { SyncStatus } from '../db/account'
import { pendingChanges, markPushed, applyChanges, hasPendingChanges, getCursor } from '../db/sync'
import { httpTransport, SessionExpired } from './syncClient'
import type { SyncTransport } from './syncClient'

export interface SyncReport {
  pushed: number
  pulled: number
  /** Rows the server refused outright; these will not be retried. */
  rejected: Array<{ table: string; key: string; reason: string }>
  error: string | null
}

/** Pages pulled in one cycle, so a cold start cannot spin forever. */
const MAX_PAGES = 100

let running: Promise<SyncReport> | null = null
let timer: ReturnType<typeof setInterval> | null = null

/** Injectable so the cycle can be tested without a server. */
let makeTransport: (account: ReturnType<typeof getAccount>) => SyncTransport | null = (account) =>
  account ? httpTransport(account) : null

export function useTransport(factory: typeof makeTransport): void {
  makeTransport = factory
}

/**
 * One push-then-pull cycle.
 *
 * Concurrent calls share the in-flight one rather than starting a second: the
 * scheduler, a window regaining focus and a manual press can easily coincide.
 */
export function syncNow(onChanged?: () => void): Promise<SyncReport> {
  if (running) return running
  running = cycle(onChanged).finally(() => {
    running = null
  })
  return running
}

async function cycle(onChanged?: () => void): Promise<SyncReport> {
  const report: SyncReport = { pushed: 0, pulled: 0, rejected: [], error: null }
  const account = getAccount()
  const transport = makeTransport(account)
  if (!account || !transport) return report

  try {
    const pending: SyncRows = pendingChanges()
    if (countRows(pending) > 0) {
      const outcome = await transport.push(pending)
      report.pushed = outcome.accepted
      report.rejected = outcome.rejected

      // Everything offered is cleared, including what the server skipped or
      // refused. A skipped row is superseded by one the pull is about to bring;
      // a refused row would otherwise be retried on every cycle forever. The
      // refusals are reported rather than silently dropped.
      markPushed(pending)
    }

    let changed = false
    for (let page = 0; page < MAX_PAGES; page++) {
      const incoming = await transport.pull(getCursor())
      const count = countRows(incoming.rows)
      if (count === 0 && !incoming.more) break

      const applied = applyChanges(incoming)
      report.pulled += applied.applied
      changed ||= applied.applied > 0
      if (!incoming.more) break
    }

    if (changed) onChanged?.()
    recordSuccess(Date.now())
  } catch (err) {
    if (err instanceof SessionExpired) {
      // Nothing is deleted: the rows stay, still dirty, and go up again once
      // the user signs back in.
      clearAccount()
      report.error = 'Signed out. Sign in again to keep syncing.'
    } else {
      report.error = err instanceof Error ? err.message : 'sync failed'
    }
    recordFailure(report.error)
  }

  return report
}

export function status(): SyncStatus {
  return readStatus(hasPendingChanges())
}

/**
 * Starts the background cycle.
 *
 * The interval is deliberately unhurried. This is a tracker, not a chat app,
 * and a device that syncs a few times an hour is indistinguishable from one
 * that syncs constantly — except in battery and in requests billed.
 */
export function startScheduler(
  intervalMs = 15 * 60 * 1000,
  onChanged?: () => void
): () => void {
  stopScheduler()
  timer = setInterval(() => {
    void syncNow(onChanged)
  }, intervalMs)

  // A first pass shortly after launch, late enough not to compete with the
  // window opening.
  const initial = setTimeout(() => void syncNow(onChanged), 5_000)

  return () => {
    clearTimeout(initial)
    stopScheduler()
  }
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
