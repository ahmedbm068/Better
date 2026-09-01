/**
 * The database seam.
 *
 * Production runs on Cloudflare D1; the tests run the identical code against
 * better-sqlite3, because D1 *is* SQLite and the SQL is the same dialect. That
 * is the whole reason this interface exists: without it the only way to test a
 * request end to end would be to deploy it.
 *
 * The shape is deliberately narrow, and in particular there is no interactive
 * transaction. D1 has no such thing — it offers `batch`, an implicit
 * transaction over a fixed list of statements — so every write path here has to
 * read first, decide in JavaScript, then submit the writes as one batch. Code
 * written against this interface cannot accidentally depend on holding a
 * transaction open across an await.
 */
export type SqlValue = string | number | null

export interface Statement {
  sql: string
  params: SqlValue[]
}

export const stmt = (sql: string, ...params: SqlValue[]): Statement => ({ sql, params })

export interface Sql {
  all<T>(sql: string, ...params: SqlValue[]): Promise<T[]>
  first<T>(sql: string, ...params: SqlValue[]): Promise<T | undefined>
  run(sql: string, ...params: SqlValue[]): Promise<number>
  /** Runs every statement, or none of them. */
  batch(statements: Statement[]): Promise<void>
  /** Applies the schema. Safe to call on every cold start. */
  migrate(statements: readonly string[]): Promise<void>
}

/** The subset of the D1 binding this uses, typed locally to avoid a dependency. */
interface D1PreparedStatement {
  bind(...values: SqlValue[]): D1PreparedStatement
  all<T>(): Promise<{ results: T[] }>
  first<T>(): Promise<T | null>
  run(): Promise<{ meta: { changes: number } }>
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>
}

export function d1(database: D1Database): Sql {
  const bound = (sql: string, params: SqlValue[]): D1PreparedStatement =>
    params.length > 0 ? database.prepare(sql).bind(...params) : database.prepare(sql)

  return {
    async all<T>(sql: string, ...params: SqlValue[]): Promise<T[]> {
      return (await bound(sql, params).all<T>()).results
    },
    async first<T>(sql: string, ...params: SqlValue[]): Promise<T | undefined> {
      return (await bound(sql, params).first<T>()) ?? undefined
    },
    async run(sql: string, ...params: SqlValue[]): Promise<number> {
      return (await bound(sql, params).run()).meta.changes
    },
    async batch(statements: Statement[]): Promise<void> {
      if (statements.length === 0) return
      await database.batch(statements.map((s) => bound(s.sql, s.params)))
    },
    async migrate(statements: readonly string[]): Promise<void> {
      // Not exec(): D1 splits that on newlines and treats each line as its own
      // statement, so a formatted CREATE TABLE fails with "incomplete input".
      // prepare() takes one statement whole, however it is laid out.
      for (const sql of statements) await database.prepare(sql).run()
    }
  }
}
