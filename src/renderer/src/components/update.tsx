/**
 * Updates.
 *
 * Better closes to the tray and is rarely quit, so an update that waits for a
 * quit can wait for weeks. This panel exists to offer the restart directly, the
 * moment there is something to restart into.
 *
 * It is deliberately unexcited. An update is not news, and nothing here
 * interrupts: no dialog, no badge, no toast. Someone who never opens Settings
 * still gets the update — on whatever day they next quit the app.
 */
import { useCallback, useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/api'
import { api } from '../lib/api'
import { useAction } from '../lib/hooks'
import { Button, Meter, Note, Panel } from './ui'

export function UpdatePanel({
  version,
  platform
}: {
  /** The version running now, from `getInfo`. */
  version: string
  platform: string
}): React.JSX.Element {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const action = useAction()

  const refresh = useCallback(() => {
    void api.updateStatus().then(setStatus)
  }, [])

  useEffect(() => {
    refresh()
    // The main process drives the whole cycle — checking, downloading, failing
    // — so the panel listens rather than polls.
    const off = api.on('update:changed', refresh)
    return off
  }, [refresh])

  const check = (): void => {
    void action.run(() => api.checkForUpdate()).then(refresh)
  }

  const install = (): void => {
    void action.run(() => api.installUpdate())
  }

  const onWeb = platform === 'web'

  return (
    <Panel
      title="Updates"
      right={<span className="micro text-faint">Version {version}</span>}
    >
      {status === null ? (
        <span className="quiet">Loading…</span>
      ) : !status.supported ? (
        <Note>
          {onWeb
            ? 'The web app is always on the newest version — a reload is the update. The Windows app updates itself.'
            : 'This build does not update itself. Installed copies check GitHub for new releases on their own.'}
        </Note>
      ) : (
        <div className="space-y-4">
          {status.state === 'ready' ? (
            <>
              <div>
                <span className="micro block mb-1">READY TO INSTALL</span>
                <span className="text-sm">
                  Version {status.version} has been downloaded.
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={install} variant="primary" disabled={action.busy}>
                  RESTART AND INSTALL
                </Button>
              </div>
              <Note>
                It will also install by itself the next time you quit Better —
                closing the window to the tray is not quitting.
              </Note>
            </>
          ) : status.state === 'available' ? (
            <>
              <div>
                <span className="micro block mb-1">DOWNLOADING</span>
                <span className="text-sm">
                  Version {status.version} — {status.percent}%
                </span>
              </div>
              <Meter value={status.percent} />
              <Note>
                This happens in the background. Nothing restarts until you say
                so, or until you next quit.
              </Note>
            </>
          ) : (
            <>
              <div>
                <span className="micro block mb-1">STATUS</span>
                <span className="text-sm">
                  {status.state === 'checking'
                    ? 'Checking for a newer version…'
                    : status.state === 'current'
                      ? 'You are on the latest version.'
                      : status.state === 'error'
                        ? 'The last check did not get through.'
                        : 'Not checked yet.'}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={check} disabled={action.busy || status.state === 'checking'}>
                  {action.busy || status.state === 'checking' ? 'Checking…' : 'Check now'}
                </Button>
              </div>
            </>
          )}

          {(action.error || (status.state === 'error' && status.message)) && (
            <Note tone="warn">
              {action.error?.message ?? status.message}
              {' — being offline is the usual reason. It will try again on its own.'}
            </Note>
          )}
        </div>
      )}
    </Panel>
  )
}
