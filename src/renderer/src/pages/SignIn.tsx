/**
 * The front door of the web app.
 *
 * Email and password first, because that is what a returning person expects to
 * see and it is the fastest way back in. The providers sit under it as the way
 * to *create* an account: every address here is one Google or GitHub has
 * vouched for, which is what lets the server skip confirmation email entirely.
 *
 * The desktop app never shows this. It works offline against a local database
 * by design, and putting a login in front of that would break the one promise
 * it has always kept.
 */
import { useState } from 'react'
import type { AuthProvider } from '@shared/api'
import { DOWNLOAD_URL } from '@shared/config'
import { useAction } from '../lib/hooks'
import { api } from '../lib/api'
import { Button, Field, Note } from '../components/ui'

const MIN_PASSWORD_LENGTH = 10

export default function SignInPage({
  onSkip
}: {
  /** Continue without an account, using this browser only. */
  onSkip: () => void
}): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const action = useAction()

  const server = window.location.origin
  const ready = email.trim().length > 0 && password.length > 0

  const withPassword = (): void => {
    if (!ready) return
    void action.run(() => api.signInWithPassword(server, email.trim(), password))
  }

  const withProvider = (provider: AuthProvider) => (): void => {
    void action.run(() => api.signIn(server, provider))
  }

  return (
    <div className="min-h-full grid place-items-center px-5 py-10">
      <div className="w-full max-w-[380px]">
        <header className="mb-7 text-center">
          <div className="num text-accent font-bold tracking-[0.2em] text-[15px]">BETTER</div>
          <p className="quiet mt-2">Prayers, habits, sleep and work — one honest score a day.</p>
        </header>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            withPassword()
          }}
        >
          <Field label="EMAIL">
            <input
              type="email"
              value={email}
              autoComplete="username"
              spellCheck={false}
              autoFocus
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field label="PASSWORD">
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            disabled={action.busy || !ready}
          >
            {action.busy ? 'SIGNING IN…' : 'SIGN IN'}
          </Button>
        </form>

        {action.error && (
          <div className="mt-3">
            <Note tone="warn">{action.error.message}</Note>
          </div>
        )}

        <div className="flex items-center gap-3 my-6">
          <span className="h-px flex-1 bg-line" />
          <span className="micro text-faint">NEW HERE</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <div className="space-y-2">
          <Button
            onClick={withProvider('google')}
            size="lg"
            className="w-full"
            disabled={action.busy}
          >
            CONTINUE WITH GOOGLE
          </Button>
          <Button
            onClick={withProvider('github')}
            size="lg"
            className="w-full"
            disabled={action.busy}
          >
            CONTINUE WITH GITHUB
          </Button>
          <p className="quiet text-center pt-1">
            Creating an account this way sets no password. You can add one
            afterwards in Settings, and use it to sign in here.
          </p>
        </div>

        <div className="mt-7 pt-5 border-t border-line">
          <div className="micro mb-1.5">ON WINDOWS</div>
          <p className="quiet mb-3">
            The desktop app runs offline, keeps its own copy of your data, and
            reminds you before a prayer window closes — which a browser tab
            cannot do once it is shut.
          </p>
          <a
            href={DOWNLOAD_URL}
            className="inline-block w-full text-center border border-line px-3 py-2 text-[12.5px] tracking-wide hover:border-line-strong"
          >
            DOWNLOAD FOR WINDOWS
          </a>
        </div>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={onSkip}
            className="quiet underline underline-offset-4 hover:text-fg"
          >
            Try it without an account
          </button>
          <p className="quiet mt-1.5">
            Stays in this browser, and is lost if you clear its data.
          </p>
        </div>
      </div>
    </div>
  )
}

export { MIN_PASSWORD_LENGTH }
