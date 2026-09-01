/**
 * Export and import, on the desktop.
 *
 * The format itself lives in `bundle.ts`, which the web client shares. What is
 * left here is everything that needs a filesystem: writing the file, reading it
 * back, and copying the database aside before an import touches anything.
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getDb, backupDatabase } from '../db/index'
import { readSettings } from '../db/settings'
import {
  TABLES,
  buildBundle,
  validateBundle,
  applyBundle,
  toCsv,
  ImportError
} from './bundle'
import type { ExportBundle, Row, TableName } from './bundle'

export {
  EXPORT_FORMAT_VERSION,
  APP_NAME,
  ImportError,
  buildBundle,
  validateBundle,
  defaultExportName
} from './bundle'
export type { ExportBundle } from './bundle'

export function exportJson(filePath: string): { path: string; counts: Record<string, number> } {
  const bundle = buildBundle()
  writeFileSync(filePath, JSON.stringify(bundle, null, 2), 'utf8')
  return { path: filePath, counts: bundle.counts }
}

/** One CSV per table, plus the settings, in a folder the user picks. */
export function exportCsv(dir: string): { path: string; files: string[] } {
  mkdirSync(dir, { recursive: true })
  const bundle: ExportBundle = buildBundle()
  const files: string[] = []

  for (const table of TABLES as readonly TableName[]) {
    const file = join(dir, `${table}.csv`)
    writeFileSync(file, toCsv(bundle.tables[table] ?? []), 'utf8')
    files.push(file)
  }

  const settings = readSettings() as unknown as Record<string, unknown>
  const settingsRows: Row[] = Object.entries(settings).map(([key, value]) => ({
    key,
    value: (Array.isArray(value) ? value.join(' ') : value) as Row[string]
  }))
  const settingsFile = join(dir, 'settings.csv')
  writeFileSync(settingsFile, toCsv(settingsRows), 'utf8')
  files.push(settingsFile)

  return { path: dir, files }
}

export interface ImportResult {
  counts: Record<string, number>
  backupPath: string
}

/**
 * Replaces all data with the bundle's, atomically.
 *
 * The existing database is copied aside first, so a bad import is always
 * recoverable from disk even though the transaction itself cannot fail halfway.
 */
export function importJson(filePath: string): ImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    throw new ImportError('That file could not be read as JSON.')
  }

  const bundle = validateBundle(parsed)
  // Before anything is deleted, so a bad restore is recoverable from disk.
  const backupPath = backupDatabase('pre-import')
  return { counts: applyBundle(bundle), backupPath }
}

/** Kept so callers that only need the handle do not reach past this module. */
export const database = getDb
