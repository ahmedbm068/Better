/**
 * A `DatabaseType` over sql.js, so the browser can run the same repositories
 * and services as the desktop app.
 *
 * The interface it fills is better-sqlite3 shaped and **synchronous**, which is
 * the whole reason sql.js is the choice here rather than the official
 * sqlite-wasm build: the services call the database straight through, and only
 * the OPFS-backed builds of sqlite-wasm are synchronous, and only inside a
 * worker. Making the database async would mean rewriting every service, and
 * then the rules would exist twice.
 *
 * The cost is that persistence is a whole-database export rather than a journal.
 * At a few hundred rows a year that is a handful of milliseconds, and it is
 * paid on a debounce rather than per write.
 */
import initSqlJs from 'sql.js'
import type { Database as SqlJsDatabase, SqlValue } from 'sql.js'
import type { DatabaseType, Statement } from '../main/db/types'

type Params = unknown[]

/** better-sqlite3 accepts either positional arguments or one named-parameter object. */
function bindArgs(params: Params): Record<string, SqlValue> | SqlValue[] {
  if (params.length === 1 && isNamedBag(params[0])) {
    const bag = params[0] as Record<string, unknown>
    const out: Record<string, SqlValue> = {}
    // sql.js wants the sigil included; the SQL in this codebase writes @name.
    for (const [key, value] of Object.entries(bag)) out[`@${key}`] = value as SqlValue
    return out
  }
  return params as SqlValue[]
}

function isNamedBag(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array)
  )
}

function makeStatement(db: SqlJsDatabase, sql: string, onWrite: () => void): Statement {
  const rows = (params: Params): Record<string, SqlValue>[] => {
    const statement = db.prepare(sql)
    try {
      statement.bind(bindArgs(params) as never)
      const out: Record<string, SqlValue>[] = []
      while (statement.step()) out.push(statement.getAsObject())
      return out
    } finally {
      statement.free()
    }
  }

  return {
    run(...params: Params) {
      const statement = db.prepare(sql)
      try {
        statement.bind(bindArgs(params) as never)
        statement.step()
      } finally {
        statement.free()
      }
      onWrite()
      const [row] = db.exec('SELECT last_insert_rowid() AS id')
      return {
        changes: db.getRowsModified(),
        lastInsertRowid: Number(row?.values?.[0]?.[0] ?? 0)
      }
    },
    get: (...params: Params) => rows(params)[0],
    all: (...params: Params) => rows(params),
    iterate: (...params: Params) => rows(params)[Symbol.iterator]()
  }
}

export interface WebDatabase extends DatabaseType {
  /** The whole database, for handing to storage. */
  export(): Uint8Array
}

/**
 * Opens a database in memory, optionally from bytes saved earlier.
 *
 * `onWrite` fires after every statement that could have changed something, so
 * the caller can debounce a save. It is deliberately not called per transaction:
 * a transaction that rolls back still leaves the caller free to save, and saving
 * an unchanged database is harmless.
 */
export interface OpenOptions {
  /** A database saved earlier, to resume from. */
  saved?: Uint8Array
  onWrite?: () => void
  /**
   * Where the sql.js wasm binary is.
   *
   * Passed in rather than imported so this module stays free of any bundler
   * syntax: the browser hands it a Vite asset URL, and the tests hand it a path
   * on disk. That is what lets the adapter be tested without a browser.
   */
  wasmUrl: string
}

export async function openWebDatabase(options: OpenOptions): Promise<WebDatabase> {
  const { saved, onWrite = () => {}, wasmUrl } = options
  const SQL = await initSqlJs({ locateFile: () => wasmUrl })

  const db = saved ? new SQL.Database(saved) : new SQL.Database()
  let inTransaction = false

  const handle: WebDatabase = {
    prepare: (sql: string) => makeStatement(db, sql, onWrite),

    exec(sql: string) {
      db.exec(sql)
      onWrite()
    },

    pragma(sql: string, options?: { simple?: boolean }) {
      const result = db.exec(`PRAGMA ${sql}`)
      onWrite()
      if (result.length === 0 || result[0].values.length === 0) {
        return options?.simple ? undefined : []
      }
      if (options?.simple) return result[0].values[0][0]
      return result[0].values.map((row) =>
        Object.fromEntries(result[0].columns.map((c, i) => [c, row[i]]))
      )
    },

    /**
     * better-sqlite3 returns a callable that runs the body in a transaction.
     * Nested calls are common in this codebase, so an inner one joins the outer
     * rather than issuing a second BEGIN, which SQLite would refuse.
     */
    transaction<T extends (...args: never[]) => unknown>(fn: T): T {
      return ((...args: never[]) => {
        if (inTransaction) return fn(...args)
        inTransaction = true
        db.exec('BEGIN')
        try {
          const result = fn(...args)
          db.exec('COMMIT')
          onWrite()
          return result
        } catch (err) {
          db.exec('ROLLBACK')
          throw err
        } finally {
          inTransaction = false
        }
      }) as T
    },

    close: () => db.close(),
    export: () => db.export(),
    open: true,
    name: 'better-web'
  }

  return handle
}
