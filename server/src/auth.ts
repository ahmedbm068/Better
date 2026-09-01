/**
 * Identity and sessions.
 *
 * GitHub OAuth first, because it needs no domain to develop against — GitHub
 * accepts a localhost callback — and because it means this server never stores
 * a password, never sends a reset email, and never holds anything that is worth
 * stealing on its own.
 *
 * The provider is reached through `IdentityProvider` so the exchange can be
 * stubbed in tests. Nothing else in the server knows which provider a user came
 * from beyond the pair of strings that identifies them.
 */
import type { Sql } from './db'
import { stmt } from './db'
import { SEED_HABITS, SEED_AVOID } from './schema'
import { uuidv7 } from '@shared/uid'
import type { SyncRows } from '@shared/sync'
import { hashPassword, verifyPassword, ITERATIONS } from './password'

/** How long a session lasts without being used. */
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000

/** How long an in-flight OAuth handshake may take. */
const STATE_TTL_MS = 10 * 60 * 1000

export interface Identity {
  provider: string
  providerId: string
  /**
   * The address the provider vouches for, lowercased.
   *
   * This is what ties one person to one account across providers, so it has to
   * be a *verified* address. GitHub will happily report an unverified one, and
   * accepting it would let anyone claim an account by adding its address to
   * their own GitHub profile.
   */
  email: string
}

export interface IdentityProvider {
  /** Where to send the browser to begin. */
  authorizeUrl(state: string): string
  /** Turns the code the provider handed back into an identity. */
  exchange(code: string): Promise<Identity>
}

export interface User {
  id: string
  email: string | null
  seeded: number
  /** Whether a password has been set. The hash itself never leaves the row. */
  hasPassword?: number
}

function token(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function beginOAuth(
  sql: Sql,
  provider: IdentityProvider,
  desktop = false
): Promise<string> {
  const state = token()
  await sql.run(
    'INSERT INTO oauth_states (state, created_at, desktop) VALUES (?, ?, ?)',
    state,
    Date.now(),
    desktop ? 1 : 0
  )
  return provider.authorizeUrl(state)
}

export class AuthError extends Error {}

/**
 * Completes the handshake and returns a session token.
 *
 * The state is deleted before the code is exchanged, so a callback can only be
 * used once even if it is replayed immediately.
 */
export async function completeOAuth(
  sql: Sql,
  provider: IdentityProvider,
  code: string,
  state: string,
  now = Date.now()
): Promise<{ token: string; user: User; desktop: boolean }> {
  const found = await sql.first<{ created_at: number; desktop: number }>(
    'SELECT created_at, desktop FROM oauth_states WHERE state = ?',
    state
  )
  await sql.run('DELETE FROM oauth_states WHERE state = ?', state)

  if (!found) throw new AuthError('unknown or already used sign-in attempt')
  if (now - found.created_at > STATE_TTL_MS) throw new AuthError('sign-in attempt expired')

  const identity = await provider.exchange(code)
  const user = await upsertUser(sql, identity, now)
  const sessionToken = token()

  await sql.run(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    sessionToken,
    user.id,
    now,
    now + SESSION_TTL_MS
  )
  return { token: sessionToken, user, desktop: found.desktop === 1 }
}

/**
 * Finds or creates the account behind a provider login.
 *
 * Three cases, in order. A known identity is simply that account. An unknown
 * identity on a known address joins the existing account, which is what makes
 * "sign up with Google, come back with GitHub" land in one place. Anything else
 * is a new account.
 */
async function upsertUser(sql: Sql, identity: Identity, now: number): Promise<User> {
  const linked = await sql.first<User>(
    `SELECT u.id, u.email, u.seeded FROM identities i
     JOIN users u ON u.id = i.user_id
     WHERE i.provider = ? AND i.provider_id = ?`,
    identity.provider,
    identity.providerId
  )
  if (linked) {
    // An account made before addresses were collected has none. Fill it in
    // from the provider now, or password sign-in would never find it.
    if (!linked.email) {
      await sql.run('UPDATE users SET email = ? WHERE id = ?', identity.email, linked.id)
      return { ...linked, email: identity.email }
    }
    return linked
  }

  const byEmail = await sql.first<User>(
    'SELECT id, email, seeded FROM users WHERE lower(email) = ?',
    identity.email
  )

  const user: User = byEmail ?? { id: uuidv7(now), email: identity.email, seeded: 0 }
  if (!byEmail) {
    await sql.run(
      'INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)',
      user.id,
      identity.email,
      now
    )
  }

  await sql.run(
    'INSERT INTO identities (provider, provider_id, user_id, created_at) VALUES (?, ?, ?, ?)',
    identity.provider,
    identity.providerId,
    user.id,
    now
  )
  return user
}

/** The user behind a bearer token, or undefined. Expired sessions do not count. */
export async function authenticate(
  sql: Sql,
  header: string | null,
  now = Date.now()
): Promise<User | undefined> {
  const bearer = header?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!bearer) return undefined

  return await sql.first<User>(
    `SELECT u.id, u.email, u.seeded,
            CASE WHEN u.password_hash IS NULL THEN 0 ELSE 1 END AS hasPassword
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`,
    bearer,
    now
  )
}

export async function signOut(sql: Sql, header: string | null): Promise<void> {
  const bearer = header?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (bearer) await sql.run('DELETE FROM sessions WHERE token = ?', bearer)
}

/**
 * Creates the starter lists, once per account.
 *
 * This is why the server seeds rather than the client: a device seeds whenever
 * its own lists are empty, so a desktop install and a browser sign-in would
 * each invent their own six habits and sync both sets. Seeding where the
 * account lives means it happens exactly once.
 */
export async function seedAccount(sql: Sql, user: User, now = Date.now()): Promise<SyncRows> {
  if (user.seeded === 1) return {}

  const rows: SyncRows = { habits: [], avoid_items: [] }
  const statements = []
  let seq = 0

  SEED_HABITS.forEach((name, index) => {
    const row = {
      uid: uuidv7(now + index),
      name,
      position: index,
      days_mask: 127,
      archived: 0,
      created_at: now,
      updated_at: now,
      deleted_at: null
    }
    rows.habits!.push(row)
    statements.push(
      stmt(
        `INSERT INTO sync_rows (user_id, tbl, row_key, data, updated_at, seq)
         VALUES (?, 'habits', ?, ?, ?, ?)`,
        user.id,
        row.uid,
        JSON.stringify(row),
        now,
        ++seq
      )
    )
  })

  SEED_AVOID.forEach((item, index) => {
    const row = {
      uid: uuidv7(now + SEED_HABITS.length + index),
      name: item.name,
      position: index,
      archived: 0,
      is_quit_tracker: item.quitTracker ? 1 : 0,
      created_at: now,
      updated_at: now,
      deleted_at: null
    }
    rows.avoid_items!.push(row)
    statements.push(
      stmt(
        `INSERT INTO sync_rows (user_id, tbl, row_key, data, updated_at, seq)
         VALUES (?, 'avoid_items', ?, ?, ?, ?)`,
        user.id,
        row.uid,
        JSON.stringify(row),
        now,
        ++seq
      )
    )
  })

  statements.push(stmt('UPDATE users SET seeded = 1, next_seq = ? WHERE id = ?', seq + 1, user.id))
  await sql.batch(statements)
  return rows
}

/**
 * GitHub.
 *
 * Asks for `user:email` as well, because the public profile often has no
 * address at all and an account here is keyed on one. Only a verified, primary
 * address is accepted: GitHub reports unverified ones too, and trusting those
 * would let anyone claim an account by adding its address to their profile.
 */
export function github(clientId: string, clientSecret: string, redirectUri: string): IdentityProvider {
  return {
    authorizeUrl(state) {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: 'read:user user:email',
        state
      })
      return `https://github.com/login/oauth/authorize?${params}`
    },

    async exchange(code) {
      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri
        })
      })
      const token = ((await response.json()) as { access_token?: string }).access_token
      if (!token) throw new AuthError('GitHub refused the sign-in')

      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        // GitHub rejects API requests that do not identify themselves.
        'User-Agent': 'Better'
      }

      const profile = await fetch('https://api.github.com/user', { headers })
      const id = ((await profile.json()) as { id?: number }).id
      if (id === undefined) throw new AuthError('GitHub did not return an account')

      const list = await fetch('https://api.github.com/user/emails', { headers })
      const emails = (await list.json()) as Array<{
        email: string
        primary: boolean
        verified: boolean
      }>
      const chosen = Array.isArray(emails)
        ? (emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified))
        : undefined
      if (!chosen) {
        throw new AuthError('Your GitHub account has no verified email address.')
      }

      return { provider: 'github', providerId: String(id), email: chosen.email.toLowerCase() }
    }
  }
}

/**
 * Google.
 *
 * The id token comes back as a JWT, but it arrives over TLS straight from
 * Google in exchange for a secret only this server holds, so its claims are
 * read without verifying the signature. Nothing else accepts that token, and a
 * forged one could not have survived the exchange.
 */
export function google(clientId: string, clientSecret: string, redirectUri: string): IdentityProvider {
  return {
    authorizeUrl(state) {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email',
        state,
        // Otherwise a returning user is bounced straight through and never sees
        // which account they are about to use.
        prompt: 'select_account'
      })
      return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
    },

    async exchange(code) {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code'
        })
      })

      const body = (await response.json()) as { id_token?: string }
      if (!body.id_token) throw new AuthError('Google refused the sign-in')

      const claims = readJwtClaims(body.id_token)
      if (!claims.sub || !claims.email) {
        throw new AuthError('Google did not return an account')
      }
      if (claims.email_verified === false) {
        throw new AuthError('That Google address is not verified.')
      }

      return { provider: 'google', providerId: claims.sub, email: claims.email.toLowerCase() }
    }
  }
}

interface JwtClaims {
  sub?: string
  email?: string
  email_verified?: boolean
}

/** Reads the payload of a JWT. Does not verify it — see `google` for why. */
function readJwtClaims(jwt: string): JwtClaims {
  const payload = jwt.split('.')[1]
  if (!payload) throw new AuthError('Google returned a malformed token')
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
  return JSON.parse(json) as JwtClaims
}

/* ---------------------------------------------------------------------------
 * Passwords
 *
 * A password is set only by someone already signed in through a provider, so
 * the address behind it is always one a provider has vouched for. That is what
 * removes the need to send email: there is no address to confirm, and a
 * forgotten password is recovered by signing in with the provider again.
 * ------------------------------------------------------------------------- */

/** How many wrong guesses before the account stops answering, and for how long. */
const MAX_FAILED_LOGINS = 8
const LOCKOUT_MS = 15 * 60 * 1000

export async function setPassword(sql: Sql, user: User, password: string): Promise<void> {
  const record = await hashPassword(password)
  await sql.run(
    `UPDATE users
     SET password_hash = ?, password_salt = ?, password_iter = ?,
         failed_logins = 0, locked_until = NULL
     WHERE id = ?`,
    record.hash,
    record.salt,
    record.iterations,
    user.id
  )
}

interface Credentials {
  id: string
  email: string | null
  seeded: number
  password_hash: string | null
  password_salt: string | null
  password_iter: number | null
  failed_logins: number
  locked_until: number | null
}

/**
 * Signs in with an address and a password.
 *
 * Every failure returns the same message. Saying "no such account" would turn
 * this into a way to ask which addresses are registered.
 */
export async function signInWithPassword(
  sql: Sql,
  email: string,
  password: string,
  now = Date.now()
): Promise<{ token: string; user: User }> {
  const refuse = (): never => {
    throw new AuthError('That email and password do not match.')
  }

  const found = await sql.first<Credentials>(
    `SELECT id, email, seeded, password_hash, password_salt, password_iter,
            failed_logins, locked_until
     FROM users WHERE lower(email) = ?`,
    email.trim().toLowerCase()
  )

  if (!found || !found.password_hash || !found.password_salt || !found.password_iter) {
    // Still costs a hash, so a missing account cannot be told from a wrong
    // password by how long the answer takes.
    await hashPassword(password)
    return refuse()
  }

  if (found.locked_until !== null && found.locked_until > now) {
    throw new AuthError('Too many attempts. Try again in a few minutes.')
  }

  const ok = await verifyPassword(password, {
    hash: found.password_hash,
    salt: found.password_salt,
    iterations: found.password_iter
  })

  if (!ok) {
    const failures = found.failed_logins + 1
    await sql.run(
      'UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?',
      failures,
      failures >= MAX_FAILED_LOGINS ? now + LOCKOUT_MS : null,
      found.id
    )
    return refuse()
  }

  const user: User = { id: found.id, email: found.email, seeded: found.seeded }
  await sql.run(
    'UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?',
    user.id
  )

  // Raise the cost silently if the stored hash predates the current setting.
  if (found.password_iter < ITERATIONS) await setPassword(sql, user, password)

  const sessionToken = token()
  await sql.run(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    sessionToken,
    user.id,
    now,
    now + SESSION_TTL_MS
  )
  return { token: sessionToken, user }
}
