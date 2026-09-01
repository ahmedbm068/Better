/**
 * Signing in from the desktop app.
 *
 * OAuth happens in the real browser, never in an Electron window. A window the
 * app controls could read what is typed into it, so a provider is right to
 * distrust one, and the user cannot see the address bar they are being asked to
 * trust. The browser is the only honest place to enter a password.
 *
 * Getting the token back is the awkward half. The app opens a loopback server
 * on a fixed port; the Worker finishes the handshake with the provider and
 * redirects the browser to that port with the token attached. The provider only
 * ever knows the Worker URL, so the redirect it is registered with never has to
 * change and no port has to be registered with GitHub at all.
 */
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { shell } from 'electron'
import { setAccount } from '../db/account'

/**
 * Fixed rather than random: it is baked into the Worker APP_URL, so the two
 * sides have to agree without talking first.
 */
export const CALLBACK_PORT = 53682

/** How long the loopback server waits before giving up on the browser. */
const WAIT_MS = 5 * 60 * 1000

const PAGE = (message: string): string =>
  `<!doctype html><meta charset="utf-8"><title>Better</title>
<body style="font:16px system-ui;padding:3rem;color:#222;background:#faf9f7">
<p>${message}</p><p style="color:#777">You can close this tab.</p>`

export class SignInError extends Error {}

/**
 * Runs the whole flow and stores the account on success.
 *
 * Resolves when the browser has come back with a token. Rejects if the user
 * gives up, the provider refuses, or nothing arrives in time.
 */
export function signIn(server: string): Promise<{ userId: string }> {
  const base = server.replace(/\/+$/, '')

  return new Promise((resolve, reject) => {
    let settled = false
    let listener: Server | null = null

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      // Closing on the next tick lets the response actually reach the browser.
      setTimeout(() => listener?.close(), 100)
      fn()
    }

    const timeout = setTimeout(
      () => finish(() => reject(new SignInError('sign-in timed out'))),
      WAIT_MS
    )

    listener = createServer((request, response) => {
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${CALLBACK_PORT}`)
      if (url.pathname !== '/callback') {
        response.writeHead(404).end()
        return
      }

      const token = url.searchParams.get('token')
      const userId = url.searchParams.get('user')
      const error = url.searchParams.get('error')

      if (error || !token || !userId) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(PAGE(error ? `Sign-in failed: ${error}` : 'Sign-in failed.'))
        finish(() => reject(new SignInError(error ?? 'the server did not return a token')))
        return
      }

      setAccount({ server: base, token, userId })
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(PAGE('Signed in. Better is now syncing.'))
      finish(() => resolve({ userId }))
    })

    listener.on('error', (err) => {
      finish(() =>
        reject(
          new SignInError(
            `could not listen on port ${CALLBACK_PORT}: ${err.message}. Another sign-in may already be in progress.`
          )
        )
      )
    })

    listener.listen(CALLBACK_PORT, '127.0.0.1', () => {
      void shell.openExternal(`${base}/auth/github/start?desktop=1`)
    })
  })
}
