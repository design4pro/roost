import { readMeta, writeMeta } from './schema'
import type { Sql } from './schema'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How far back the change log reaches. A client offline for longer than this
 * gets a snapshot instead of a delta, which is correct but expensive - so the
 * window is generous enough that a laptop shut for a fortnight still resumes.
 */
export const CHANGE_LOG_DAYS = 14

/** Executed commands are kept only long enough to survive a reconnect. */
export const COMMAND_HISTORY_DAYS = 7

/**
 * Trim the log. Idempotent: running it twice in a row is a no-op, which
 * matters because an alarm can fire again after a failure part-way through.
 */
export function prune(sql: Sql, now: number): { rowsWritten: number } {
  const changeCutoff = now - CHANGE_LOG_DAYS * DAY_MS
  const commandCutoff = now - COMMAND_HISTORY_DAYS * DAY_MS

  const highest = sql
    .exec<{ seq: number | null }>(
      'SELECT MAX(seq) AS seq FROM changes WHERE ts < ?',
      changeCutoff,
    )
    .toArray()[0]?.seq

  let rowsWritten = 0
  if (highest != null) {
    const cursor = sql.exec('DELETE FROM changes WHERE ts < ?', changeCutoff)
    cursor.toArray()
    rowsWritten += cursor.rowsWritten
    // Recorded in the same block as the delete, so a client can never be told
    // "you are up to date" about ops that have just gone.
    writeMeta(sql, 'log_starts_at', String(highest))
  }

  const commands = sql.exec(
    'DELETE FROM commands WHERE done_at IS NOT NULL AND done_at < ?',
    commandCutoff,
  )
  commands.toArray()
  rowsWritten += commands.rowsWritten

  return { rowsWritten }
}

export const logStartsAt = (sql: Sql): number =>
  Number(readMeta(sql, 'log_starts_at') ?? '0')
