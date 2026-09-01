/**
 * The sync server, end to end.
 *
 * Runs the real routes, the real merge and the real SQL against better-sqlite3
 * instead of D1. D1 is SQLite, so this is the same code and the same dialect
 * that production runs; the only thing stubbed is the OAuth exchange, which
 * would otherwise need GitHub and a browser.
 *
 * Build and run:  npm run server-check
 */
import { app } from 'electron'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Sql, SqlValue, Statement } from '../server/src/db'
import type { ServerMigration } from '../server/src/schema'
import { MIGRATIONS } from '../server/src/schema'
import { handle } from '../server/src/index'
import type { Env } from '../server/src/index'
import {
  beginOAuth,
  completeOAuth,
  seedAccount,
  authenticate,
  setPassword,
  signInWithPassword
} from '../server/src/auth'
import { rejectWeakPassword } from '../server/src/password'
import type { IdentityProvider } from '../server/src/auth'
import { push, pull } from '../server/src/changes'
import type { SyncRows } from '../src/shared/sync'
import { uuidv7 } from '../src/shared/uid'
import { MAKEUP_WINDOW_MS } from '../src/shared/prayer'

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed++
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(name: string): void {
  console.log(`\n${name}`)
}

/** The same Sql surface D1 provides, over a local file. */
function sqlite(file: string): Sql & { close(): void } {
  const db = new Database(file)
  db.pragma('foreign_keys = ON')
  return {
    close: () => db.close(),
    async all<T>(sql: string, ...params: SqlValue[]): Promise<T[]> {
      return db.prepare(sql).all(...params) as T[]
    },
    async first<T>(sql: string, ...params: SqlValue[]): Promise<T | undefined> {
      return (db.prepare(sql).get(...params) as T | undefined) ?? undefined
    },
    async run(sql: string, ...params: SqlValue[]): Promise<number> {
      return db.prepare(sql).run(...params).changes
    },
    async batch(statements: Statement[]): Promise<void> {
      db.transaction(() => {
        for (const s of statements) db.prepare(s.sql).run(...s.params)
      })()
    },
    async migrate(migrations: readonly ServerMigration[]): Promise<void> {
      // Mirrors the D1 adapter: versioned, one statement per prepare. Using
      // exec() here is what hid a production failure once — D1 splits exec on
      // newlines, better-sqlite3 does not.
      db.prepare(
        'CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
      ).run()
      const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as
        | { value: string }
        | undefined
      const current = row ? Number(row.value) : 0
      for (const migration of migrations) {
        if (migration.version <= current) continue
        db.transaction(() => {
          for (const sql of migration.statements) db.prepare(sql).run()
          db.prepare(
            "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('version', ?)"
          ).run(String(migration.version))
        })()
      }
    }
  }
}

/** Stands in for GitHub. The identity is whatever the code says it is. */
const stubProvider = (
  id = '12345',
  email = 'ahmed@example.com',
  provider = 'github'
): IdentityProvider => ({
  authorizeUrl: (state) => `https://example.invalid/authorize?state=${state}`,
  exchange: async (code) => ({
    provider,
    providerId: code === 'other' ? 'other' : id,
    email
  })
})

const env = (): Env =>
  ({
    DB: undefined as never,
    // The static bundle is not built during this check, so a request that
    // reaches it is a routing mistake and says so rather than 404ing quietly.
    ASSETS: {
      fetch: async () => new Response('served the web client', { status: 200 })
    },
    GITHUB_CLIENT_ID: 'id',
    GITHUB_CLIENT_SECRET: 'secret',
    OAUTH_REDIRECT_URI: 'http://localhost:8787/auth/github/callback'
  }) as unknown as Env

/** A prayer times row for a day, so marks for it can be judged. */
function timesRow(date: string, base: number): Record<string, SqlValue> {
  return {
    date,
    fajr: base,
    sunrise: base + 90 * 60000,
    dhuhr: base + 6 * 3600000,
    asr: base + 9 * 3600000,
    maghrib: base + 12 * 3600000,
    isha: base + 13 * 3600000,
    latitude: 36.8,
    longitude: 10.2,
    method: 'MuslimWorldLeague',
    madhab: 'shafi',
    tz: 'Africa/Tunis',
    computed_at: base
  }
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'better-server-'))
  const sql = sqlite(join(dir, 'server.sqlite'))
  const now = Date.UTC(2026, 7, 1, 9, 0, 0)

  try {
    await sql.migrate(MIGRATIONS)

    section('signing in')
    const authorizeUrl = await beginOAuth(sql, stubProvider())
    const state = new URL(authorizeUrl).searchParams.get('state')!
    check('the handshake carries a state', state.length === 64)

    const { token, user } = await completeOAuth(sql, stubProvider(), 'code', state)
    check('a session token comes back', token.length === 64)
    check('the account is new', user.seeded === 0)

    check(
      'the same state cannot be used twice',
      await completeOAuth(sql, stubProvider(), 'code', state).then(
        () => false,
        () => true
      ),
      'a replayed callback is refused'
    )

    check(
      'a bearer token identifies the user',
      (await authenticate(sql, `Bearer ${token}`))?.id === user.id
    )
    check('a wrong token does not', (await authenticate(sql, 'Bearer nope')) === undefined)
    check('an absent header does not', (await authenticate(sql, null)) === undefined)

    section('the account seeds once, not once per device')
    const seeded = await seedAccount(sql, user, now)
    check('the starter habits were created', seeded.habits?.length === 6)
    check('so was the avoid list', seeded.avoid_items?.length === 4)

    const again = await seedAccount(sql, { id: user.id, email: user.email, seeded: 1 }, now)
    check('a second device seeds nothing', Object.keys(again).length === 0)
    const all = await pull(sql, user.id, 0)
    check('the account holds one set of ten', all.rows.habits?.length === 6, '6 habits, not 12')

    section('pushing and pulling')
    const habitUid = uuidv7(now)
    const first = await push(
      sql,
      user.id,
      {
        habits: [
          {
            uid: habitUid,
            name: 'Sport',
            position: 9,
            days_mask: 127,
            archived: 0,
            created_at: now,
            updated_at: now,
            deleted_at: null
          }
        ]
      },
      now
    )
    check('the row was accepted', first.accepted === 1 && first.rejected.length === 0)
    check('the cursor moved past the seed', first.seq > 10, `seq ${first.seq}`)

    const since = await pull(sql, user.id, all.seq!)
    check('only what is new comes back', since.rows.habits?.length === 1)
    check('and it is the pushed row', since.rows.habits?.[0].uid === habitUid)

    section('the server applies the same merge rules')
    const stale = await push(
      sql,
      user.id,
      {
        habits: [
          {
            uid: habitUid,
            name: 'Stale',
            position: 9,
            days_mask: 127,
            archived: 0,
            created_at: now,
            updated_at: now - 1000,
            deleted_at: null
          }
        ]
      },
      now
    )
    check('an older edit is refused', stale.accepted === 0 && stale.skipped === 1)

    section('a clock running ahead cannot win every merge')
    const future = now + 60 * 60 * 1000
    await push(
      sql,
      user.id,
      {
        habits: [
          {
            uid: habitUid,
            name: 'From the future',
            position: 9,
            days_mask: 127,
            archived: 0,
            created_at: now,
            updated_at: future,
            deleted_at: null
          }
        ]
      },
      now
    )
    const clamped = await pull(sql, user.id, 0)
    const stored = clamped.rows.habits?.find((h) => h.uid === habitUid)
    check(
      'the timestamp was clamped to server time',
      Number(stored?.updated_at) === now,
      `claimed ${future}, stored ${stored?.updated_at}`
    )

    section('a prayer times snapshot is never rewritten')
    await push(sql, user.id, { prayer_times: [timesRow('2026-08-01', now)] }, now)
    const moved = timesRow('2026-08-01', now)
    moved.fajr = now + 3600000
    const rewrite = await push(sql, user.id, { prayer_times: [moved] }, now)
    check('the second snapshot is refused', rewrite.skipped === 1 && rewrite.accepted === 0)

    section('a prayer mark is judged against the window')
    await push(sql, user.id, { prayer_times: [timesRow('2026-08-02', now + 86400000)] }, now)

    // Windows for 2026-08-01, from timesRow: fajr [0h, 1.5h), dhuhr [6h, 9h),
    // asr [9h, 12h), maghrib [12h, 13h) — all relative to `now`.
    const H = 3600000
    const mark = (prayer: string, doneAt: number): Record<string, SqlValue> => ({
      date: '2026-08-01',
      prayer,
      done_at: doneAt,
      updated_at: now,
      deleted_at: null
    })

    // One push, four independent keys, so each verdict stands on its own rather
    // than on whichever push happened to land last.
    const judged = await push(
      sql,
      user.id,
      {
        prayer_marks: [
          mark('fajr', now + 5 * H), // closed 3.5h ago: a make-up, still allowed
          mark('dhuhr', now + 9 * H + MAKEUP_WINDOW_MS + H), // long past the limit
          mark('asr', now + 8 * H), // an hour before that window opened
          mark('maghrib', now + 12.5 * H) // squarely inside its window
        ]
      },
      now
    )

    const reasonFor = (key: string): string =>
      judged.rejected.find((r) => r.key.includes(key))?.reason ?? ''

    check('a make-up soon after the window is accepted', judged.accepted === 2)
    check('a mark far past the make-up limit is rejected', reasonFor('dhuhr').length > 0)
    check(
      'and the reason names the make-up, not the window',
      reasonFor('dhuhr').includes('made up'),
      reasonFor('dhuhr')
    )
    check('a mark from before the window opened is rejected', reasonFor('asr').length > 0)
    check(
      'and that reason says the window had not opened',
      reasonFor('asr').includes('had not opened'),
      reasonFor('asr')
    )
    check('exactly the two bad marks were refused', judged.rejected.length === 2)

    const unknownDay = await push(
      sql,
      user.id,
      {
        prayer_marks: [
          { date: '2026-12-25', prayer: 'fajr', done_at: now, updated_at: now, deleted_at: null }
        ]
      },
      now
    )
    check(
      'a mark for a day with no snapshot is rejected',
      unknownDay.rejected.length === 1,
      unknownDay.rejected[0]?.reason
    )

    section('a client cannot smuggle extra columns through')
    const smuggled = await push(
      sql,
      user.id,
      {
        day_notes: [
          { date: '2026-08-01', note: 'fine', updated_at: now, deleted_at: null, evil: '<script>' }
        ] as unknown as SyncRows['day_notes']
      },
      now
    )
    check('the row is still accepted', smuggled.accepted === 1)
    const notes = await pull(sql, user.id, 0)
    check(
      'but the unknown column was dropped',
      !('evil' in (notes.rows.day_notes?.[0] ?? {})),
      'rows are handed to other devices verbatim'
    )

    section('paging')
    const page = await pull(sql, user.id, 0, 3)
    check('a page is capped', page.rows.habits!.length + (page.rows.avoid_items?.length ?? 0) === 3)
    check('and says there is more', page.more === true)


    section('one person, one account, whichever provider they use')
    const gh = await beginOAuth(sql, stubProvider())
    const ghState = new URL(gh).searchParams.get('state')!
    const ghUser = await completeOAuth(sql, stubProvider('777', 'shared@example.com'), 'c', ghState)

    const gg = await beginOAuth(sql, stubProvider())
    const ggState = new URL(gg).searchParams.get('state')!
    const ggUser = await completeOAuth(
      sql,
      stubProvider('888', 'shared@example.com', 'google'),
      'c',
      ggState
    )
    check(
      'the same address reaches the same account',
      ghUser.user.id === ggUser.user.id,
      'signing up with one provider and returning with another'
    )
    check(
      'both logins are recorded against it',
      (await sql.all('SELECT provider FROM identities WHERE user_id = ?', ghUser.user.id)).length === 2
    )

    const gg2 = await beginOAuth(sql, stubProvider())
    const other = await completeOAuth(
      sql,
      stubProvider('999', 'someone-else@example.com', 'google'),
      'c',
      new URL(gg2).searchParams.get('state')!
    )
    check('a different address does not', other.user.id !== ghUser.user.id)

    section('an account made before addresses were collected')
    await sql.run('UPDATE users SET email = NULL WHERE id = ?', ghUser.user.id)
    const revisit = await beginOAuth(sql, stubProvider())
    const backfilled = await completeOAuth(
      sql,
      stubProvider('777', 'shared@example.com'),
      'c',
      new URL(revisit).searchParams.get('state')!
    )
    check(
      'signing in again fills the address in',
      backfilled.user.email === 'shared@example.com',
      'without it, password sign-in could never find the account'
    )
    check('and it is the same account', backfilled.user.id === ghUser.user.id)

    section('passwords')
    check('a short one is refused', rejectWeakPassword('hunter2') !== null)
    check('a long one is fine', rejectWeakPassword('correct horse battery') === null)
    check('a non-string is refused', rejectWeakPassword(12345678901) !== null)

    await setPassword(sql, ghUser.user, 'correct horse battery')
    const good = await signInWithPassword(sql, 'shared@example.com', 'correct horse battery')
    check('signing in with it works', good.user.id === ghUser.user.id)
    check('and issues a session', (await authenticate(sql, `Bearer ${good.token}`))?.id === ghUser.user.id)

    check(
      'the address is matched case-insensitively',
      (await signInWithPassword(sql, 'SHARED@example.com', 'correct horse battery')).user.id ===
        ghUser.user.id
    )

    const wrong = await signInWithPassword(sql, 'shared@example.com', 'not the password').then(
      () => 'ACCEPTED',
      (e: Error) => e.message
    )
    check('a wrong password is refused', wrong !== 'ACCEPTED', wrong)

    const unknown = await signInWithPassword(sql, 'nobody@example.com', 'whatever').then(
      () => 'ACCEPTED',
      (e: Error) => e.message
    )
    check(
      'an unknown address gives the same answer',
      unknown === wrong,
      'or it would reveal which addresses are registered'
    )

    const noPassword = await signInWithPassword(sql, 'someone-else@example.com', 'anything').then(
      () => 'ACCEPTED',
      (e: Error) => e.message
    )
    check('an account with no password cannot be signed into', noPassword !== 'ACCEPTED')

    section('a password guesser is locked out')
    for (let i = 0; i < 8; i++) {
      await signInWithPassword(sql, 'shared@example.com', 'wrong').catch(() => undefined)
    }
    const locked = await signInWithPassword(sql, 'shared@example.com', 'correct horse battery').then(
      () => 'ACCEPTED',
      (e: Error) => e.message
    )
    check(
      'even the right password is refused while locked',
      locked.includes('Too many'),
      locked
    )


    section('two people cannot see each other')
    const alice = await completeOAuth(
      sql,
      stubProvider('a1', 'alice@example.com'),
      'c',
      new URL(await beginOAuth(sql, stubProvider())).searchParams.get('state')!
    )
    const bob = await completeOAuth(
      sql,
      stubProvider('b1', 'bob@example.com'),
      'c',
      new URL(await beginOAuth(sql, stubProvider())).searchParams.get('state')!
    )
    check('they are different accounts', alice.user.id !== bob.user.id)

    const noteFor = (who: string): SyncRows => ({
      day_notes: [
        { date: '2026-10-01', note: `${who} wrote this`, updated_at: now, deleted_at: null }
      ]
    })
    await push(sql, alice.user.id, noteFor('alice'), now)
    await push(sql, bob.user.id, noteFor('bob'), now)

    const alicePull = await pull(sql, alice.user.id, 0)
    const bobPull = await pull(sql, bob.user.id, 0)
    const aliceNotes = alicePull.rows.day_notes ?? []
    const bobNotes = bobPull.rows.day_notes ?? []

    check(
      'each sees exactly one note on that day',
      aliceNotes.length === 1 && bobNotes.length === 1,
      `alice ${aliceNotes.length}, bob ${bobNotes.length}`
    )
    check('and it is their own', aliceNotes[0]?.note === 'alice wrote this')
    check('not the other one', bobNotes[0]?.note === 'bob wrote this')
    check(
      'nothing of the other account leaks into a pull',
      JSON.stringify(alicePull.rows).includes('bob') === false,
      'the whole change set is scoped to one user'
    )

    const aliceSession = await authenticate(sql, `Bearer ${alice.token}`)
    check(
      'a session only ever resolves to its own account',
      aliceSession?.id === alice.user.id && aliceSession?.id !== bob.user.id
    )

    // Writing under one account must not touch another, even on the same key.
    const beforeBob = (await pull(sql, bob.user.id, 0)).rows.day_notes?.[0]?.note
    await push(sql, alice.user.id, noteFor('alice again'), now + 1000)
    const afterBob = (await pull(sql, bob.user.id, 0)).rows.day_notes?.[0]?.note
    check('a write by one leaves the other untouched', beforeBob === afterBob, String(afterBob))

    section('the routes')
    const bearer = { Authorization: `Bearer ${token}` }
    const health = await handle(new Request('http://x/health'), env(), sql)
    check('health is open', health.status === 200)

    const noAuth = await handle(new Request('http://x/changes'), env(), sql)
    check('changes needs a session', noAuth.status === 401)

    const withAuth = await handle(
      new Request('http://x/changes?since=0', { headers: bearer }),
      env(),
      sql
    )
    check('with one it answers', withAuth.status === 200)

    const me = await handle(new Request('http://x/me', { headers: bearer }), env(), sql)
    check('and knows who is asking', ((await me.json()) as { id: string }).id === user.id)

    const badBody = await handle(
      new Request('http://x/changes', { method: 'POST', headers: bearer, body: 'not json' }),
      env(),
      sql
    )
    check('a bad body is a 400, not a 500', badBody.status === 400)

    const missing = await handle(new Request('http://x/nope', { headers: bearer }), env(), sql)
    check('an unknown route is a 404', missing.status === 404)

    const signedOut = await handle(
      new Request('http://x/auth/signout', { method: 'POST', headers: bearer }),
      env(),
      sql
    )
    check('signing out works', signedOut.status === 200)
    check(
      'and the token stops working',
      (await handle(new Request('http://x/me', { headers: bearer }), env(), sql)).status === 401
    )
  } finally {
    // Windows will not remove a file that still has an open handle.
    sql.close()
    rmSync(dir, { recursive: true, force: true })
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  app.exit(failed === 0 ? 0 : 1)
}

app.whenReady().then(() =>
  main().catch((err) => {
    console.error(err)
    app.exit(1)
  })
)
