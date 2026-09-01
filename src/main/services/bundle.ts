/**
 * The backup format, without the filesystem.
 *
 * Split out of `backupService` so the web client can build and restore the same
 * bundle. Importing that module in a browser would pull in `node:fs`; nothing
 * here reads or writes a file, and the caller decides whether the bytes become
 * a save dialog or a download.
 */
import type { Settings } from '@shared/types'
import { getDb } from '../db/handle'
import { readSettings, writeSettings } from '../db/settings'
import { backfillSyncIdentity } from '../db/schema'

export const EXPORT_FORMAT_VERSION = 1

/** The current app name, plus every name it has shipped under. */
export const APP_NAME = 'Better'
const KNOWN_APP_NAMES = [APP_NAME, "I'm HIM"]

/** Tables dumped verbatim, in an order safe to re-insert (parents first). */
export const TABLES = [
  'habits',
  'habit_logs',
  'avoid_items',
  'avoid_logs',
  'prayer_times',
  'prayer_marks',
  'work_sessions',
  'sleep_sessions',
  'day_notes',
  'weekly_reviews'
] as const

export type TableName = (typeof TABLES)[number]
export type Row = Record<string, unknown>

export interface ExportBundle {
  app: string
  formatVersion: number
  exportedAt: string
  schemaVersion: number
  settings: Settings
  tables: Record<TableName, Row[]>
  counts: Record<string, number>
}

/**
 * A backup is what the user still has, so tombstoned rows are left out. The
 * `uid` column is kept: restoring preserves each row's identity, so a restore
 * followed by a sync updates rows rather than duplicating them.
 */
function dumpTable(table: TableName): Row[] {
  const where = tableColumns(table).includes('deleted_at') ? ' WHERE deleted_at IS NULL' : ''
  return getDb().prepare(`SELECT * FROM ${table}${where}`).all() as Row[]
}

export function buildBundle(): ExportBundle {
  const tables = {} as Record<TableName, Row[]>
  const counts: Record<string, number> = {}
  for (const table of TABLES) {
    tables[table] = dumpTable(table)
    counts[table] = tables[table].length
  }
  return {
    app: APP_NAME,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    schemaVersion: getDb().pragma('user_version', { simple: true }) as number,
    settings: readSettings(),
    tables,
    counts
  }
}
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: Row[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const lines = [headers.join(',')]
  for (const row of rows) lines.push(headers.map((h) => csvCell(row[h])).join(','))
  return `${lines.join('\r\n')}\r\n`
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}

/** Rejects anything that is not a bundle this app wrote, before touching data. */
export function validateBundle(raw: unknown): ExportBundle {
  if (typeof raw !== 'object' || raw === null) throw new ImportError('That file is not valid JSON.')
  const bundle = raw as Partial<ExportBundle>
  if (typeof bundle.app !== 'string' || !KNOWN_APP_NAMES.includes(bundle.app)) {
    throw new ImportError('That file was not exported by this app.')
  }
  if (typeof bundle.formatVersion !== 'number' || bundle.formatVersion > EXPORT_FORMAT_VERSION) {
    throw new ImportError(
      `Backup format v${bundle.formatVersion} is newer than this app understands (v${EXPORT_FORMAT_VERSION}).`
    )
  }
  if (typeof bundle.tables !== 'object' || bundle.tables === null) {
    throw new ImportError('The backup has no data section.')
  }
  for (const table of TABLES) {
    const rows = (bundle.tables as Record<string, unknown>)[table]
    if (rows !== undefined && !Array.isArray(rows)) {
      throw new ImportError(`The "${table}" section is malformed.`)
    }
  }
  return bundle as ExportBundle
}

/**
 * Replaces all stored data with the bundle, in one transaction.
 *
 * Taking a copy of the database first is the caller's job: only the desktop has
 * somewhere to put one.
 */
export function applyBundle(bundle: ExportBundle): Record<string, number> {
  const db = getDb()
  const counts: Record<string, number> = {}

  const run = db.transaction(() => {
    // Children first, so foreign keys stay satisfied throughout.
    for (const table of [...TABLES].reverse()) db.prepare(`DELETE FROM ${table}`).run()

    for (const table of TABLES) {
      const rows = (bundle.tables[table] ?? []) as Row[]
      counts[table] = 0
      if (rows.length === 0) continue
      const columns = tableColumns(table)
      const usable = Object.keys(rows[0]).filter((c) => columns.includes(c))
      if (usable.length === 0) continue
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO ${table} (${usable.join(', ')}) VALUES (${usable
          .map((c) => `@${c}`)
          .join(', ')})`
      )
      for (const row of rows) {
        const values: Row = {}
        for (const c of usable) values[c] = row[c] ?? null
        stmt.run(values)
        counts[table]++
      }
    }
  })

  run()
  // A bundle written before sync existed carries no uid, and its rows would be
  // invisible to the server until they were given one.
  backfillSyncIdentity(db)
  if (bundle.settings) writeSettings(bundle.settings)
  return counts
}

function tableColumns(table: TableName): string[] {
  const info = getDb().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return info.map((c) => c.name)
}

/** A timestamped default filename for the save dialog. */
export function defaultExportName(extension: 'json' | 'csv'): string {
  const stamp = new Date().toISOString().slice(0, 10)
  return extension === 'json' ? `better-backup-${stamp}.json` : `better-export-${stamp}`
}
