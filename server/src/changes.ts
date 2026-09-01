/**
 * Pull and push.
 *
 * The merge rules are the ones in `@shared/sync`, applied here as well as on
 * the client: both sides have to reach the same answer, and a rule that lived
 * only on the client would be a rule the server could quietly disagree with.
 */
import type { ChangeSet, SyncRow, SyncRows, SyncTable, SyncTableSpec } from '@shared/sync'
import { SYNC_TABLES, SYNC_TABLE_BY_NAME, incomingWins } from '@shared/sync'
import type { DayPrayerTimes, Millis, PrayerName } from '@shared/types'
import { PRAYERS } from '@shared/types'
import { windowFor, isRecordable } from '@shared/prayer'
import { addDays } from '@shared/time'
import type { Sql, SqlValue, Statement } from './db'
import { stmt } from './db'

/** How many rows one pull returns. A cold client walks the history in pages. */
export const PAGE_SIZE = 500

interface StoredRow {
  tbl: SyncTable
  row_key: string
  data: string
  updated_at: number
  seq: number
}

/** The identity of a row, as one string, for the storage key. */
export function rowKey(spec: SyncTableSpec, row: SyncRow): string {
  return spec.key.map((column) => String(row[column] ?? '')).join(' ')
}

/**
 * Strips a wire row to the columns its table declares.
 *
 * Anything else a client sends is dropped rather than stored: the row is
 * handed back to other devices verbatim, so unvetted keys would be a way to
 * push arbitrary content through the server to another of the user's clients.
 */
export function sanitize(spec: SyncTableSpec, raw: unknown): SyncRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const source = raw as Record<string, unknown>
  const row: SyncRow = {}

  for (const column of spec.columns) {
    const value = source[column]
    if (value === undefined || value === null) {
      row[column] = null
    } else if (typeof value === 'number' || typeof value === 'string') {
      row[column] = value
    } else if (typeof value === 'boolean') {
      row[column] = value ? 1 : 0
    } else {
      return null
    }
  }

  // A row with an empty identity cannot be addressed, so it cannot be stored.
  if (spec.key.some((column) => row[column] === null || row[column] === '')) return null
  return row
}

export async function pull(
  sql: Sql,
  userId: string,
  since: number,
  limit = PAGE_SIZE
): Promise<ChangeSet & { more: boolean }> {
  const stored = await sql.all<StoredRow>(
    `SELECT tbl, data, seq FROM sync_rows
     WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?`,
    userId,
    since,
    limit + 1
  )

  const more = stored.length > limit
  const page = more ? stored.slice(0, limit) : stored

  const rows: SyncRows = {}
  for (const record of page) {
    const spec = SYNC_TABLE_BY_NAME[record.tbl]
    if (!spec) continue
    ;(rows[record.tbl] ??= []).push(JSON.parse(record.data) as SyncRow)
  }

  return { seq: page.length > 0 ? page[page.length - 1].seq : since, rows, more }
}

export interface Rejection {
  table: SyncTable
  key: string
  reason: string
}

export interface PushResult {
  accepted: number
  /** Rows an existing newer version beat, or that a first-write rule refused. */
  skipped: number
  rejected: Rejection[]
  /** The sequence to pull from next; the client stores it as its cursor. */
  seq: number
}

export async function push(
  sql: Sql,
  userId: string,
  incoming: SyncRows,
  now: Millis = Date.now()
): Promise<PushResult> {
  const result: PushResult = { accepted: 0, skipped: 0, rejected: [], seq: 0 }

  // Everything that will be written, keyed so a later row in the same push
  // supersedes an earlier one rather than both being queued.
  const staged = new Map<string, { spec: SyncTableSpec; key: string; row: SyncRow }>()

  for (const spec of SYNC_TABLES) {
    const rows = incoming[spec.table]
    if (!Array.isArray(rows)) continue

    for (const raw of rows) {
      const row = sanitize(spec, raw)
      if (!row) {
        result.rejected.push({ table: spec.table, key: '', reason: 'malformed row' })
        continue
      }

      // A client cannot date a row into the future. Left unclamped, one wrong
      // clock would win every merge it took part in until real time caught up.
      if (spec.columns.includes('updated_at')) {
        row.updated_at = Math.min(Number(row.updated_at ?? 0), now)
      }

      const key = rowKey(spec, row)
      staged.set(`${spec.table} ${key}`, { spec, key, row })
    }
  }

  if (staged.size === 0) {
    result.seq = await currentSeq(sql, userId)
    return result
  }

  const existing = await loadExisting(sql, userId, [...staged.values()])
  const times = new PrayerTimeLookup(sql, userId, staged)

  const winners: Array<{ spec: SyncTableSpec; key: string; row: SyncRow }> = []
  for (const candidate of staged.values()) {
    const { spec, key, row } = candidate
    const held = existing.get(`${spec.table} ${key}`)

    if (!incomingWins(spec.policy, row, held)) {
      result.skipped++
      continue
    }

    if (spec.table === 'prayer_marks') {
      const refusal = await checkPrayerMark(row, times)
      if (refusal) {
        result.rejected.push({ table: spec.table, key, reason: refusal })
        continue
      }
    }

    winners.push(candidate)
  }

  const base = await currentSeq(sql, userId)
  const statements: Statement[] = winners.map((winner, index) =>
    stmt(
      `INSERT INTO sync_rows (user_id, tbl, row_key, data, updated_at, seq)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, tbl, row_key) DO UPDATE SET
         data = excluded.data, updated_at = excluded.updated_at, seq = excluded.seq`,
      userId,
      winner.spec.table,
      winner.key,
      JSON.stringify(winner.row),
      Number(winner.row.updated_at ?? now),
      base + 1 + index
    )
  )

  const next = base + winners.length + 1
  if (statements.length > 0) {
    // Guarded on the sequence we read, so two devices pushing at once cannot
    // both hand out the same numbers; the loser retries with a fresh base.
    statements.push(
      stmt('UPDATE users SET next_seq = ? WHERE id = ? AND next_seq = ?', next, userId, base + 1)
    )
    await sql.batch(statements)
  }

  result.accepted = winners.length
  result.seq = next - 1
  return result
}

async function currentSeq(sql: Sql, userId: string): Promise<number> {
  const user = await sql.first<{ next_seq: number }>(
    'SELECT next_seq FROM users WHERE id = ?',
    userId
  )
  return (user?.next_seq ?? 1) - 1
}

/** The stored version of every row in this push, for the merge decision. */
async function loadExisting(
  sql: Sql,
  userId: string,
  candidates: Array<{ spec: SyncTableSpec; key: string }>
): Promise<Map<string, SyncRow>> {
  const held = new Map<string, SyncRow>()

  for (const spec of SYNC_TABLES) {
    const keys = candidates.filter((c) => c.spec.table === spec.table).map((c) => c.key)
    if (keys.length === 0) continue

    // Chunked to stay well inside the bound-parameter limit on a large push.
    for (let i = 0; i < keys.length; i += 100) {
      const chunk = keys.slice(i, i + 100)
      const rows = await sql.all<StoredRow>(
        `SELECT tbl, row_key, data, updated_at FROM sync_rows
         WHERE user_id = ? AND tbl = ? AND row_key IN (${chunk.map(() => '?').join(', ')})`,
        userId,
        spec.table,
        ...(chunk as SqlValue[])
      )
      for (const record of rows) {
        held.set(`${record.tbl} ${record.row_key}`, JSON.parse(record.data) as SyncRow)
      }
    }
  }
  return held
}

/**
 * Reads prayer time snapshots, preferring one in the same push.
 *
 * A device that has been offline sends the day it recorded and the marks for it
 * together, so the snapshot needed to judge a mark is often not stored yet.
 */
class PrayerTimeLookup {
  private cache = new Map<string, SyncRow | undefined>()

  constructor(
    private sql: Sql,
    private userId: string,
    private staged: Map<string, { spec: SyncTableSpec; key: string; row: SyncRow }>
  ) {}

  async get(date: string): Promise<SyncRow | undefined> {
    if (this.cache.has(date)) return this.cache.get(date)

    let found = this.staged.get(`prayer_times ${date}`)?.row
    if (!found) {
      const stored = await this.sql.first<StoredRow>(
        'SELECT data FROM sync_rows WHERE user_id = ? AND tbl = ? AND row_key = ?',
        this.userId,
        'prayer_times',
        date
      )
      found = stored ? (JSON.parse(stored.data) as SyncRow) : undefined
    }

    this.cache.set(date, found)
    return found
  }
}

/**
 * Refuses a prayer mark whose claimed time falls outside what the rules allow.
 *
 * The window itself, plus the make-up period after it — the server has to
 * accept both, or a qada recorded on one device would be rejected on sync and
 * silently vanish. It still refuses a mark before the window opened, one from
 * long after it closed, and one for a day the device never had times for.
 *
 * Worth being exact about what this does not do: it is not tamper-proof. An
 * offline device supplies its own `done_at`, so a client that lies about when
 * it prayed will be believed. Only a mark made while online is witnessed by
 * this server at the moment it happens. Note also that the server checks the
 * bound, not the resulting state — whether a mark reads as done or late is
 * derived from the same times on every client, so there is nothing to agree on.
 */
async function checkPrayerMark(row: SyncRow, times: PrayerTimeLookup): Promise<string | null> {
  const prayer = String(row.prayer) as PrayerName
  if (!PRAYERS.includes(prayer)) return 'unknown prayer'

  // A tombstone withdraws a mark and is always allowed; the client only lets
  // one be made while the window is open.
  if (row.deleted_at !== null && row.deleted_at !== undefined) return null

  const date = String(row.date)
  const today = await times.get(date)
  const tomorrow = await times.get(addDays(date, 1))
  if (!today || !tomorrow) return 'no prayer times recorded for that day'

  const dayTimes: DayPrayerTimes = {
    date,
    fajr: Number(today.fajr),
    sunrise: Number(today.sunrise),
    dhuhr: Number(today.dhuhr),
    asr: Number(today.asr),
    maghrib: Number(today.maghrib),
    isha: Number(today.isha),
    nextFajr: Number(tomorrow.fajr)
  }

  const doneAt = Number(row.done_at ?? 0)
  const window = windowFor(dayTimes, prayer)
  if (doneAt < window.start) return 'that prayer window had not opened at the time claimed'
  if (!isRecordable(window, doneAt)) return 'that prayer was made up too long after its window closed'
  return null
}
