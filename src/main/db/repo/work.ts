/** Focused work sessions. */
import type { DateStr, Millis, WorkSession } from '@shared/types'
import { uuidv7 } from '@shared/uid'
import { getDb } from '../handle'

interface WorkRow {
  id: number
  uid: string
  date: DateStr
  project: string
  started_at: Millis
  ended_at: Millis | null
  note: string | null
  updated_at: Millis
  deleted_at: Millis | null
}

const toSession = (r: WorkRow, now = Date.now()): WorkSession => ({
  id: r.id,
  uid: r.uid,
  date: r.date,
  project: r.project,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  note: r.note,
  durationSec: Math.max(0, Math.floor(((r.ended_at ?? now) - r.started_at) / 1000))
})

/** Deletes are tombstones, so every read has to exclude them explicitly. */
const LIVE = 'deleted_at IS NULL'

export function listWorkByDate(date: DateStr): WorkSession[] {
  const now = Date.now()
  return (
    getDb()
      .prepare(`SELECT * FROM work_sessions WHERE date = ? AND ${LIVE} ORDER BY started_at`)
      .all(date) as WorkRow[]
  ).map((r) => toSession(r, now))
}

export function listWorkInRange(from: DateStr, to: DateStr): WorkSession[] {
  const now = Date.now()
  return (
    getDb()
      .prepare(
        `SELECT * FROM work_sessions WHERE date BETWEEN ? AND ? AND ${LIVE} ORDER BY started_at`
      )
      .all(from, to) as WorkRow[]
  ).map((r) => toSession(r, now))
}

export function getWorkSession(id: number): WorkSession | null {
  const row = getDb().prepare(`SELECT * FROM work_sessions WHERE id = ? AND ${LIVE}`).get(id) as
    | WorkRow
    | undefined
  return row ? toSession(row) : null
}

/** The sync layer's lookup: incoming rows carry a uid, never a local id. */
export function getWorkSessionByUid(uid: string): WorkSession | null {
  const row = getDb().prepare(`SELECT * FROM work_sessions WHERE uid = ? AND ${LIVE}`).get(uid) as
    | WorkRow
    | undefined
  return row ? toSession(row) : null
}

/** The session currently running, if any. At most one runs at a time. */
export function getRunningSession(): WorkSession | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM work_sessions
       WHERE ended_at IS NULL AND ${LIVE} ORDER BY started_at DESC LIMIT 1`
    )
    .get() as WorkRow | undefined
  return row ? toSession(row) : null
}

export function startWork(date: DateStr, project: string, startedAt = Date.now()): WorkSession {
  const info = getDb()
    .prepare(
      `INSERT INTO work_sessions (uid, date, project, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(uuidv7(startedAt), date, project.trim() || 'Untitled', startedAt, Date.now())
  return getWorkSession(Number(info.lastInsertRowid))!
}

export function stopWork(id: number, endedAt = Date.now(), note?: string | null): WorkSession | null {
  const session = getWorkSession(id)
  if (!session) return null
  // Never let a clock adjustment produce a negative duration.
  const safeEnd = Math.max(endedAt, session.startedAt)
  getDb()
    .prepare('UPDATE work_sessions SET ended_at = ?, note = ?, updated_at = ? WHERE id = ?')
    .run(safeEnd, note?.trim() || null, Date.now(), id)
  return getWorkSession(id)
}

export function updateWorkSession(
  id: number,
  patch: { project?: string; startedAt?: Millis; endedAt?: Millis | null; note?: string | null; date?: DateStr }
): WorkSession | null {
  const current = getWorkSession(id)
  if (!current) return null
  const startedAt = patch.startedAt ?? current.startedAt
  const endedAt = patch.endedAt === undefined ? current.endedAt : patch.endedAt
  getDb()
    .prepare(
      `UPDATE work_sessions
       SET project = ?, started_at = ?, ended_at = ?, note = ?, date = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      patch.project?.trim() ?? current.project,
      startedAt,
      endedAt == null ? null : Math.max(endedAt, startedAt),
      patch.note === undefined ? current.note : patch.note?.trim() || null,
      patch.date ?? current.date,
      Date.now(),
      id
    )
  return getWorkSession(id)
}

export function deleteWorkSession(id: number): void {
  const now = Date.now()
  getDb()
    .prepare(`UPDATE work_sessions SET deleted_at = ?, updated_at = ? WHERE id = ? AND ${LIVE}`)
    .run(now, now, id)
}

/** Distinct project names, most recently used first — feeds the autocomplete. */
export function listProjects(): string[] {
  const rows = getDb()
    .prepare(
      `SELECT project, MAX(started_at) AS last FROM work_sessions
       WHERE ${LIVE} GROUP BY project ORDER BY last DESC`
    )
    .all() as Array<{ project: string; last: Millis }>
  return rows.map((r) => r.project)
}

export function secondsOnDate(date: DateStr): number {
  return listWorkByDate(date).reduce((sum, s) => sum + s.durationSec, 0)
}

export function secondsInRange(from: DateStr, to: DateStr): number {
  return listWorkInRange(from, to).reduce((sum, s) => sum + s.durationSec, 0)
}

/** Totals per project across a date range, largest first. */
export function projectTotals(from: DateStr, to: DateStr): Array<{ project: string; seconds: number }> {
  const totals = new Map<string, number>()
  for (const s of listWorkInRange(from, to)) {
    totals.set(s.project, (totals.get(s.project) ?? 0) + s.durationSec)
  }
  return [...totals.entries()]
    .map(([project, seconds]) => ({ project, seconds }))
    .sort((a, b) => b.seconds - a.seconds)
}

export function allWorkSessions(): WorkSession[] {
  const now = Date.now()
  return (
    getDb().prepare(`SELECT * FROM work_sessions WHERE ${LIVE} ORDER BY started_at`).all() as WorkRow[]
  ).map((r) => toSession(r, now))
}

export function earliestWorkDate(): DateStr | null {
  const row = getDb().prepare(`SELECT MIN(date) AS d FROM work_sessions WHERE ${LIVE}`).get() as {
    d: DateStr | null
  }
  return row?.d ?? null
}
