/**
 * One SQLite database per user, inside their Durable Object.
 *
 * Each replicated entity gets its own table, and the entity's payload lives in
 * a single `data` JSON column rather than in a column per field. The columns
 * that are broken out are exactly the ones a statement needs to filter on:
 * ownership (`device_id`) and the cascade when a window closes (`window_id`).
 *
 * That is a deliberate middle ground. A column per field would buy typed
 * queries this code never makes; one shared `entities(kind, id, data)` table
 * would lose per-entity write accounting, which the free-plan row budget is
 * measured in. Separate tables with a JSON payload keep the accounting and the
 * per-row diff while leaving the schema small enough to read in one screen.
 *
 * There are no indexes. Every index is another row written per insert, the row
 * budget is the binding constraint, and the tables are small enough that the
 * two scans this code performs (cascade on window close, and the snapshot
 * build) cost less than the writes an index would add.
 */
export const SCHEMA_VERSION = 1

const DDL = [
  `CREATE TABLE IF NOT EXISTS devices (
     id TEXT PRIMARY KEY,
     data TEXT NOT NULL,
     last_client_seq INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS windows (
     id TEXT PRIMARY KEY,
     device_id TEXT NOT NULL,
     data TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS tab_groups (
     id TEXT PRIMARY KEY,
     device_id TEXT NOT NULL,
     window_id TEXT NOT NULL,
     data TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS tabs (
     id TEXT PRIMARY KEY,
     device_id TEXT NOT NULL,
     window_id TEXT NOT NULL,
     data TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS bookmarks (
     id TEXT PRIMARY KEY,
     device_id TEXT NOT NULL,
     data TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS commands (
     id TEXT PRIMARY KEY,
     target_device_id TEXT NOT NULL,
     origin_device_id TEXT NOT NULL,
     body TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     done_at INTEGER
   )`,
  // The op log. `seq` is the only ordering in the system: clients replay from
  // the last one they applied, and nothing else has to agree about a clock.
  `CREATE TABLE IF NOT EXISTS changes (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     ts INTEGER NOT NULL,
     device_id TEXT NOT NULL,
     payload TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
]

export type Sql = SqlStorage

export function migrate(sql: Sql): void {
  for (const statement of DDL) sql.exec(statement)
  sql.exec(
    `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    String(SCHEMA_VERSION),
  )
}

export function readMeta(sql: Sql, key: string): string | null {
  const row = sql
    .exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)
    .toArray()[0]
  return row?.value ?? null
}

export function writeMeta(sql: Sql, key: string, value: string): void {
  sql.exec(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  )
}
