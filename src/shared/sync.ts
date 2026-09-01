/**
 * The sync wire format.
 *
 * Shared deliberately: the desktop client, the server and the web client all
 * have to agree on what a row looks like in flight and on who wins a conflict.
 * Keeping the rules in one table-driven place means a policy can be read off,
 * rather than reconstructed from three implementations that drifted apart.
 *
 * Rows on the wire never carry a local integer id. A row is addressed by its
 * `uid`, or by the natural key it already had, and a foreign key travels as the
 * parent uid — `habit_uid`, not `habit_id`. Local ids are private to a device.
 */

/** Every table whose rows belong to the user and therefore travel. */
export const SYNC_TABLE_NAMES = [
  'habits',
  'habit_logs',
  'avoid_items',
  'avoid_logs',
  'work_sessions',
  'sleep_sessions',
  'day_notes',
  'weekly_reviews',
  'prayer_marks',
  'prayer_times'
] as const

export type SyncTable = (typeof SYNC_TABLE_NAMES)[number]

/**
 * Who wins when both sides changed the same row.
 *
 * `last-write-wins` compares `updated_at`; for two devices editing one habit,
 * the more recent edit is what the user means.
 *
 * `first-write-wins` is only for prayer time snapshots. They are the record of
 * what a day was judged against, so a device that computed a day differently —
 * after you travelled — must never overwrite the times already in force. The
 * day you lived keeps its own times.
 */
export type MergePolicy = 'last-write-wins' | 'first-write-wins'

export interface SyncTableSpec {
  readonly table: SyncTable
  /** Columns identifying a row across devices. */
  readonly key: readonly string[]
  readonly policy: MergePolicy
  /** Every column carried on the wire, the key included. */
  readonly columns: readonly string[]
  /** False for tables that record history and are never withdrawn. */
  readonly tombstones: boolean
}

/**
 * Parents come before children, and applying a set in this order means a log
 * never arrives before the habit it belongs to.
 */
export const SYNC_TABLES: readonly SyncTableSpec[] = [
  {
    table: 'habits',
    key: ['uid'],
    policy: 'last-write-wins',
    tombstones: true,
    columns: [
      'uid',
      'name',
      'position',
      'days_mask',
      'archived',
      'created_at',
      'updated_at',
      'deleted_at'
    ]
  },
  {
    table: 'habit_logs',
    key: ['habit_uid', 'date'],
    policy: 'last-write-wins',
    tombstones: true,
    columns: ['habit_uid', 'date', 'done', 'grace', 'updated_at', 'deleted_at']
  },
  {
    table: 'avoid_items',
    key: ['uid'],
    policy: 'last-write-wins',
    tombstones: true,
    columns: [
      'uid',
      'name',
      'position',
      'archived',
      'is_quit_tracker',
      'created_at',
      'updated_at',
      'deleted_at'
    ]
  },
  {
    table: 'avoid_logs',
    key: ['item_uid', 'date'],
    policy: 'last-write-wins',
    tombstones: true,
    columns: ['item_uid', 'date', 'status', 'note', 'updated_at', 'deleted_at']
  },
  {
    table: 'work_sessions',
    key: ['uid'],
    policy: 'last-write-wins',
    tombstones: true,
    columns: [
      'uid',
      'date',
      'project',
      'started_at',
      'ended_at',
      'note',
      'updated_at',
      'deleted_at'
    ]
  },
  {
    table: 'sleep_sessions',
    key: ['date'],
    policy: 'last-write-wins',
    tombstones: true,
    columns: ['date', 'sleep_at', 'wake_at', 'note', 'updated_at', 'deleted_at']
  },
  {
    table: 'day_notes',
    key: ['date'],
    policy: 'last-write-wins',
    tombstones: true,
    columns: ['date', 'note', 'updated_at', 'deleted_at']
  },
  {
    table: 'weekly_reviews',
    key: ['week_start'],
    policy: 'last-write-wins',
    tombstones: true,
    columns: ['week_start', 'note', 'fix_next', 'created_at', 'updated_at', 'deleted_at']
  },
  {
    table: 'prayer_marks',
    key: ['date', 'prayer'],
    policy: 'last-write-wins',
    tombstones: true,
    columns: ['date', 'prayer', 'done_at', 'updated_at', 'deleted_at']
  },
  {
    table: 'prayer_times',
    key: ['date'],
    policy: 'first-write-wins',
    tombstones: false,
    columns: [
      'date',
      'fajr',
      'sunrise',
      'dhuhr',
      'asr',
      'maghrib',
      'isha',
      'latitude',
      'longitude',
      'method',
      'madhab',
      'tz',
      'computed_at'
    ]
  }
]

export const SYNC_TABLE_BY_NAME: Readonly<Record<SyncTable, SyncTableSpec>> = Object.freeze(
  Object.fromEntries(SYNC_TABLES.map((spec) => [spec.table, spec])) as Record<
    SyncTable,
    SyncTableSpec
  >
)

/** A row in flight. Values are only ever SQLite scalars. */
export type SyncValue = string | number | null
export type SyncRow = Record<string, SyncValue>

export type SyncRows = { [T in SyncTable]?: SyncRow[] }

export interface ChangeSet {
  /**
   * The server sequence these rows were read at. A client stores it and asks
   * for changes after it next time; on a push it is absent, since only the
   * server assigns sequences.
   */
  seq?: number
  rows: SyncRows
}

/** Total rows in a set, for logging and for deciding whether a push is worth making. */
export function countRows(rows: SyncRows): number {
  return SYNC_TABLES.reduce((sum, spec) => sum + (rows[spec.table]?.length ?? 0), 0)
}

/**
 * Whether an incoming row should replace the one already held.
 *
 * `local` is undefined when the row is new, in which case it is always applied.
 * A missing `updated_at` on either side sorts as 0, so a row that predates
 * timestamps loses to one that has a real time rather than winning by accident.
 */
export function incomingWins(
  policy: MergePolicy,
  incoming: SyncRow,
  local: SyncRow | undefined
): boolean {
  if (local === undefined) return true
  if (policy === 'first-write-wins') return false
  return Number(incoming.updated_at ?? 0) > Number(local.updated_at ?? 0)
}
