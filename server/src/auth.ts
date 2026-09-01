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

/** How long a session lasts without being used. */
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000

/** How long an in-flight OAuth handshake may take. */
const STATE_TTL_MS = 10 * 60 * 1000

export interface Identity {
  provider: string
  providerId: string
}

export interface IdentityProvider {
  /** Where to send the browser to begin. */
  authorizeUrl(state: string): string
  /** Turns the code the provider handed back into an identity. */
  exchange(code: string): Promise<Identity>
}

export interface User {
  id: string
  seeded: number
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

async function upsertUser(sql: Sql, identity: Identity, now: number): Promise<User> {
  const existing = await sql.first<User>(
    'SELECT id, seeded FROM users WHERE provider = ? AND provider_id = ?',
    identity.provider,
    identity.providerId
  )
  if (existing) return existing

  const id = uuidv7(now)
  await sql.run(
    'INSERT INTO users (id, provider, provider_id, created_at) VALUES (?, ?, ?, ?)',
    id,
    identity.provider,
    identity.providerId,
    now
  )
  return { id, seeded: 0 }
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
    `SELECT u.id, u.seeded FROM sessions s
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

/** GitHub, the only provider wired up so far. */
export function github(clientId: string, clientSecret: string, redirectUri: string): IdentityProvider {
  return {
    authorizeUrl(state) {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: 'read:user',
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

      const profile = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          // GitHub rejects API requests that do not identify themselves.
          'User-Agent': 'Better'
        }
      })
      const id = ((await profile.json()) as { id?: number }).id
      if (id === undefined) throw new AuthError('GitHub did not return an account')

      return { provider: 'github', providerId: String(id) }
    }
  }
}
