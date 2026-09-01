/**
 * A structural type for the better-sqlite3 handle.
 *
 * The runtime import stays a plain `require` of the native module; this keeps
 * the rest of the main process typed without leaking the native binding's
 * generics through every call site.
 */
export interface Statement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
  iterate(...params: unknown[]): IterableIterator<unknown>
}

export interface DatabaseType {
  prepare(sql: string): Statement
  exec(sql: string): void
  pragma(sql: string, options?: { simple?: boolean }): unknown
  transaction<T extends (...args: never[]) => unknown>(fn: T): T
  close(): void
  readonly open: boolean
  readonly name: string
}
