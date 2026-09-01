/**
 * The Worker.
 *
 * Small on purpose: everything the routes do lives in `auth.ts` and
 * `changes.ts`, which know nothing about HTTP and are tested directly. This
 * file is the part that cannot be tested without a request, so it is kept to
 * routing, parsing and status codes.
 */
import type { D1Database } from './db'
import { d1 } from './db'
import type { Sql } from './db'
import { MIGRATIONS } from './schema'
import {
  authenticate,
  beginOAuth,
  completeOAuth,
  github,
  google,
  seedAccount,
  setPassword,
  signInWithPassword,
  signOut,
  AuthError
} from './auth'
import { rejectWeakPassword } from './password'
import { pull, push, PAGE_SIZE } from './changes'
import type { SyncRows } from '@shared/sync'

export interface Env {
  DB: D1Database
  /**
   * The built web client, served by this same Worker.
   *
   * One origin for the app and its API is the point: no CORS preflights, no
   * second host to configure, and a content policy that can stay `'self'`.
   */
  ASSETS: { fetch(request: Request): Promise<Response> }
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  /** Where GitHub sends the browser back to, and where the app collects a token. */
  OAUTH_REDIRECT_URI: string
  /** Where the browser lands after a successful sign-in, token in the fragment. */
  APP_URL?: string
  /** Overrides where a desktop sign-in is sent back to. */
  DESKTOP_CALLBACK_URL?: string
  /**
   * The bucket holding the Windows installer.
   *
   * Optional: the installer is far larger than a Worker asset may be, so it
   * lives in R2. Until that is enabled the download falls through to the
   * releases page, which keeps the button honest rather than broken.
   */
  DOWNLOADS?: R2Bucket
  /** Where /download sends people when the bucket is not configured. */
  RELEASES_URL?: string
}

/** The object key for the current installer. */
const INSTALLER_KEY = 'Better-Setup.exe'

const RELEASES_FALLBACK = 'https://github.com/ahmedbm068/Better/releases/latest'

/** Matches CALLBACK_PORT in the desktop app; the two have to agree. */
const DESKTOP_CALLBACK = 'http://127.0.0.1:53682/callback'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  })

const problem = (message: string, status: number): Response => json({ error: message }, status)

export async function handle(request: Request, env: Env, sql: Sql): Promise<Response> {
  const url = new URL(request.url)
  const route = `${request.method} ${url.pathname}`
  /** The provider named in the path, with its own callback URL. */
  const provider = (name: string) => {
    const redirect = env.OAUTH_REDIRECT_URI.replace(/\/auth\/\w+\/callback$/, `/auth/${name}/callback`)
    if (name === 'google') {
      return google(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirect)
    }
    return github(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET, redirect)
  }
  const providerName = url.pathname.split('/')[2] ?? 'github'
  const known = providerName === 'github' || providerName === 'google'

  switch (route) {
    case 'GET /health':
      return json({ ok: true })

    case 'GET /download': {
      const object = await env.DOWNLOADS?.get(INSTALLER_KEY)
      if (!object) {
        return Response.redirect(env.RELEASES_URL ?? RELEASES_FALLBACK, 302)
      }
      return new Response(object.body, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${INSTALLER_KEY}"`,
          'Content-Length': String(object.size),
          // Installers are immutable once published; a day is plenty and keeps
          // repeat downloads off the bucket.
          'Cache-Control': 'public, max-age=86400'
        }
      })
    }

    case 'GET /auth/github/start':
    case 'GET /auth/google/start':
      return Response.redirect(
        await beginOAuth(sql, provider(providerName), url.searchParams.get('desktop') === '1'),
        302
      )

    case 'GET /auth/github/callback':
    case 'GET /auth/google/callback': {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      if (!code || !state) return problem('missing code or state', 400)

      try {
        if (!known) return problem('unknown provider', 404)
        const { token, user, desktop } = await completeOAuth(
          sql,
          provider(providerName),
          code,
          state
        )
        await seedAccount(sql, user)

        if (desktop) {
          // Back to the loopback server the app opened. A query string is safe
          // here in a way it would not be on the open web: the request never
          // leaves the machine.
          const target = new URL(env.DESKTOP_CALLBACK_URL ?? DESKTOP_CALLBACK)
          target.searchParams.set('token', token)
          target.searchParams.set('user', user.id)
          if (user.email) target.searchParams.set('email', user.email)
          return Response.redirect(target.toString(), 302)
        }

        // Back into the app, which this same Worker serves, so the origin we
        // were reached on is the right place to send them. APP_URL only exists
        // for a split deployment.
        //
        // The token rides in the fragment, which a browser never sends to a
        // server, so it stays out of every access log on the way.
        const app = env.APP_URL ?? url.origin
        const fragment = new URLSearchParams({ token, user: user.id })
        if (user.email) fragment.set('email', user.email)
        return Response.redirect(`${app}/#${fragment}`, 302)
      } catch (err) {
        if (err instanceof AuthError) return problem(err.message, 401)
        throw err
      }
    }
    case 'POST /auth/login': {
      let body: { email?: unknown; password?: unknown }
      try {
        body = (await request.json()) as { email?: unknown; password?: unknown }
      } catch {
        return problem('body was not JSON', 400)
      }
      if (typeof body.email !== 'string' || typeof body.password !== 'string') {
        return problem('email and password are required', 400)
      }

      try {
        const { token, user } = await signInWithPassword(sql, body.email, body.password)
        return json({ token, user: { id: user.id, email: user.email } })
      } catch (err) {
        if (err instanceof AuthError) return problem(err.message, 401)
        throw err
      }
    }
  }

  // Everything below needs a session.
  const user = await authenticate(sql, request.headers.get('Authorization'))
  if (!user) return problem('sign in first', 401)

  switch (route) {
    case 'GET /me':
      return json({ id: user.id, email: user.email, hasPassword: user.hasPassword === 1 })

    case 'POST /auth/password': {
      let body: { password?: unknown }
      try {
        body = (await request.json()) as { password?: unknown }
      } catch {
        return problem('body was not JSON', 400)
      }

      const refusal = rejectWeakPassword(body.password)
      if (refusal) return problem(refusal, 400)

      await setPassword(sql, user, body.password as string)
      return json({ ok: true })
    }

    case 'POST /auth/signout':
      await signOut(sql, request.headers.get('Authorization'))
      return json({ ok: true })

    case 'GET /changes': {
      const since = Number(url.searchParams.get('since') ?? 0)
      if (!Number.isFinite(since) || since < 0) return problem('bad cursor', 400)

      const limit = Math.min(Number(url.searchParams.get('limit') ?? PAGE_SIZE), PAGE_SIZE)
      return json(await pull(sql, user.id, since, limit))
    }

    case 'POST /changes': {
      let body: { rows?: SyncRows }
      try {
        body = (await request.json()) as { rows?: SyncRows }
      } catch {
        return problem('body was not JSON', 400)
      }
      if (!body.rows || typeof body.rows !== 'object') return problem('no rows', 400)

      return json(await push(sql, user.id, body.rows))
    }
  }

  return problem('no such endpoint', 404)
}

/** Paths this Worker answers itself. Everything else is the web client. */
const API_PREFIXES = ['/health', '/auth/', '/me', '/changes', '/download']

const isApiRoute = (pathname: string): boolean =>
  API_PREFIXES.some((prefix) =>
    prefix.endsWith('/') ? pathname.startsWith(prefix) : pathname === prefix
  )

/**
 * The schema, applied once per isolate rather than once per request.
 *
 * Kept as the promise so concurrent requests share one attempt, and cleared on
 * failure so a transient error does not wedge the isolate permanently.
 */
let schemaReady: Promise<void> | null = null

function ensureSchema(sql: Sql): Promise<void> {
  schemaReady ??= sql.migrate(MIGRATIONS).catch((err: unknown) => {
    schemaReady = null
    throw err
  })
  return schemaReady
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)

    // Static first, and without touching the database: most requests are for
    // the app itself, and they should not pay for a migration check.
    if (!isApiRoute(pathname)) return env.ASSETS.fetch(request)

    const sql = d1(env.DB)
    await ensureSchema(sql)
    try {
      return await handle(request, env, sql)
    } catch (err) {
      // Never let an internal message reach the client; it may quote SQL.
      console.error(err)
      return problem('something went wrong', 500)
    }
  }
}
