/**
 * Signing in, and the state of syncing.
 *
 * Deliberately plain about what it does and does not know. An account is
 * optional: signed out, the app is exactly what it has always been, and the
 * panel says so rather than nagging.
 */
import { useCallback, useEffect, useState } from 'react'
import type { SyncStatus } from '@shared/api'
import { DEFAULT_SYNC_SERVER } from '@shared/config'
import { formatDurationShort } from '@shared/format'
import { api } from '../lib/api'
import { useAction } from '../lib/hooks'
import { Button, Field, Note, Panel } from './ui'

/** "4m ago", or "never". Relative, because the exact minute is never the point. */
function ago(at: number | null, now: number): string {
  if (at === null) return 'never'
  const elapsed = now - at
  return elapsed < 45_000 ? 'just now' : `${formatDurationShort(elapsed)} ago`
}

export function SyncPanel({ platform }: { platform: string }): React.JSX.Element {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [server, setServer] = useState(DEFAULT_SYNC_SERVER)
  const [now, setNow] = useState(Date.now())
  const action = useAction()

  const refresh = useCallback(() => {
    void api.syncStatus().then(setStatus)
  }, [])

  useEffect(() => {
    refresh()
    // The main process syncs on its own schedule, so the panel listens rather
    // than polls; the clock tick is only to keep "4m ago" honest.
    const off = api.on('sync:changed', refresh)
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [refresh])

  if (!status) {
    return (
      <Panel title="Account">
        <span className="quiet">Loading…</span>
      </Panel>
    )
  }

  // On the web the server is wherever the page came from, so there is nothing
  // to ask; only the desktop has to be told where to sign in.
  const onWeb = platform === 'web'

  const signIn = (): void => {
    void action.run(() => api.signIn(onWeb ? window.location.origin : server.trim()))
  }

  const signOut = (): void => {
    void action.run(() => api.signOut()).then(refresh)
  }

  const syncNow = (): void => {
    void action.run(() => api.syncNow()).then(refresh)
  }

  return (
    <Panel
      title="Account"
      right={
        status.signedIn ? (
          <span className="micro text-faint">
            {status.pending ? 'CHANGES QUEUED' : 'UP TO DATE'}
          </span>
        ) : (
          <span className="micro text-faint">LOCAL ONLY</span>
        )
      }
    >
      {status.signedIn ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="micro block mb-1">SERVER</span>
              <span className="text-sm break-all">{status.server}</span>
            </div>
            <div>
              <span className="micro block mb-1">LAST SYNC</span>
              <span className="text-sm">{ago(status.lastSyncAt, now)}</span>
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={syncNow} disabled={action.busy}>
              {action.busy ? 'SYNCING…' : 'SYNC NOW'}
            </Button>
            <Button onClick={signOut} variant="danger" disabled={action.busy}>
              SIGN OUT
            </Button>
          </div>

          <Note>
            Signing out forgets the account on this device. Nothing recorded here
            is deleted, and it goes back up the next time you sign in.
          </Note>
        </div>
      ) : (
        <div className="space-y-4">
          <Note>
            Better works without an account. Signing in keeps the same data on
            every device you use — and is the only copy that survives clearing
            this browser.
          </Note>

          {!onWeb && (
            <Field label="SYNC SERVER" hint="Where your account lives.">
              <input
                type="text"
                value={server}
                spellCheck={false}
                onChange={(e) => setServer(e.target.value)}
              />
            </Field>
          )}

          <Button onClick={signIn} variant="primary" disabled={action.busy}>
            {action.busy ? 'OPENING…' : 'SIGN IN WITH GITHUB'}
          </Button>

          {!onWeb && (
            <Note>
              This opens your browser rather than a window inside the app — a
              window the app controls could read what you type into it.
            </Note>
          )}
        </div>
      )}

      {(action.error || status.lastError) && (
        <div className="mt-4">
          <Note tone="warn">{action.error?.message ?? status.lastError}</Note>
        </div>
      )}
    </Panel>
  )
}
