/**
 * Signing in, and the state of syncing.
 *
 * Deliberately plain about what it does and does not know. An account is
 * optional: signed out, the app is exactly what it has always been, and the
 * panel says so rather than nagging.
 *
 * Signing up always goes through a provider, so the address on an account is
 * always one Google or GitHub has vouched for. A password can be added
 * afterwards for signing in directly — and because the provider is still
 * attached, forgetting it costs a provider sign-in rather than a reset email.
 */
import { useCallback, useEffect, useState } from 'react'
import type { AuthProvider, SyncStatus } from '@shared/api'
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

/** Matches the server, so the message arrives before a round trip does. */
const MIN_PASSWORD_LENGTH = 10

type Mode = 'choose' | 'password'

export function SyncPanel({ platform }: { platform: string }): React.JSX.Element {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [server, setServer] = useState(DEFAULT_SYNC_SERVER)
  const [mode, setMode] = useState<Mode>('choose')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [settingPassword, setSettingPassword] = useState(false)
  const [done, setDone] = useState<string | null>(null)
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
  const target = (): string => (onWeb ? window.location.origin : server.trim())

  const withProvider = (provider: AuthProvider) => (): void => {
    void action.run(() => api.signIn(target(), provider))
  }

  const withPassword = (): void => {
    void action
      .run(() => api.signInWithPassword(target(), email.trim(), password))
      .then((ok) => {
        if (ok) {
          setPassword('')
          refresh()
        }
      })
  }

  const savePassword = (): void => {
    setDone(null)
    void action.run(() => api.setPassword(newPassword)).then((ok) => {
      if (ok) {
        setNewPassword('')
        setSettingPassword(false)
        setDone('Password saved. You can now sign in with it directly.')
        refresh()
      }
    })
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
        <span className="micro text-faint">
          {status.signedIn ? (status.pending ? 'CHANGES QUEUED' : 'UP TO DATE') : 'LOCAL ONLY'}
        </span>
      }
    >
      {status.signedIn ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <span className="micro block mb-1">SIGNED IN AS</span>
              <span className="text-sm break-all">{status.email ?? 'this account'}</span>
            </div>
            <div>
              <span className="micro block mb-1">SERVER</span>
              <span className="text-sm break-all">{status.server}</span>
            </div>
            <div>
              <span className="micro block mb-1">LAST SYNC</span>
              <span className="text-sm">{ago(status.lastSyncAt, now)}</span>
            </div>
          </div>

          {settingPassword ? (
            <div className="space-y-3">
              <Field
                label="NEW PASSWORD"
                hint={`At least ${MIN_PASSWORD_LENGTH} characters. Length is what makes one hard to guess.`}
              >
                <input
                  type="password"
                  value={newPassword}
                  autoComplete="new-password"
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </Field>
              <div className="flex gap-2">
                <Button
                  onClick={savePassword}
                  variant="primary"
                  disabled={action.busy || newPassword.length < MIN_PASSWORD_LENGTH}
                >
                  SAVE PASSWORD
                </Button>
                <Button onClick={() => setSettingPassword(false)} variant="ghost">
                  CANCEL
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button onClick={syncNow} disabled={action.busy}>
                {action.busy ? 'SYNCING…' : 'SYNC NOW'}
              </Button>
              <Button onClick={() => setSettingPassword(true)}>SET A PASSWORD</Button>
              <Button onClick={signOut} variant="danger" disabled={action.busy}>
                SIGN OUT
              </Button>
            </div>
          )}

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

          {mode === 'choose' ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button onClick={withProvider('google')} variant="primary" disabled={action.busy}>
                  CONTINUE WITH GOOGLE
                </Button>
                <Button onClick={withProvider('github')} disabled={action.busy}>
                  CONTINUE WITH GITHUB
                </Button>
              </div>
              <Button onClick={() => setMode('password')} variant="ghost">
                I ALREADY HAVE A PASSWORD
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Field label="EMAIL">
                <input
                  type="email"
                  value={email}
                  autoComplete="username"
                  spellCheck={false}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field label="PASSWORD">
                <input
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') withPassword()
                  }}
                />
              </Field>
              <div className="flex gap-2">
                <Button
                  onClick={withPassword}
                  variant="primary"
                  disabled={action.busy || !email.trim() || !password}
                >
                  {action.busy ? 'SIGNING IN…' : 'SIGN IN'}
                </Button>
                <Button onClick={() => setMode('choose')} variant="ghost">
                  BACK
                </Button>
              </div>
              <Note>
                Forgotten it? Continue with Google or GitHub instead, then set a
                new one. There is no reset email to wait for.
              </Note>
            </div>
          )}

          {!onWeb && mode === 'choose' && (
            <Note>
              This opens your browser rather than a window inside the app — a
              window the app controls could read what you type into it.
            </Note>
          )}
        </div>
      )}

      {done && (
        <div className="mt-4">
          <Note>{done}</Note>
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
