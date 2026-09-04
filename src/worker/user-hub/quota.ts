import { readMeta, writeMeta } from './schema'
import type { Sql } from './schema'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The free-plan Durable Objects allowance is 100 000 written rows per account
 * per day, and going past it does not raise an error the code can catch - the
 * write simply stops happening. So the object keeps its own count and refuses
 * first, which turns a silent data loss into a message the client can act on.
 *
 * `WRITE_BUDGET_PER_DAY = "0"` disables the accounting entirely; that is what a
 * Paid-plan deployment sets.
 */
export interface QuotaState {
  day: number
  rowsWritten: number
}

const dayOf = (now: number) => Math.floor(now / DAY_MS)

export function readQuota(sql: Sql, now: number): QuotaState {
  const day = dayOf(now)
  const storedDay = Number(readMeta(sql, 'write_day') ?? '0')
  if (storedDay !== day) return { day, rowsWritten: 0 }
  return { day, rowsWritten: Number(readMeta(sql, 'rows_written') ?? '0') }
}

/**
 * Whether a batch may run. The check is made before the batch, on an estimate,
 * because there is no way to undo half of it afterwards - a refusal that comes
 * too late is the failure mode this exists to avoid.
 */
export function checkBudget(
  sql: Sql,
  budget: number,
  estimate: number,
  now: number,
): { allowed: true } | { allowed: false; retryAt: number } {
  if (budget <= 0) return { allowed: true }
  const { day, rowsWritten } = readQuota(sql, now)
  if (rowsWritten + estimate <= budget) return { allowed: true }
  // Midnight UTC, when the platform's own counter rolls over.
  return { allowed: false, retryAt: (day + 1) * DAY_MS }
}

export function recordWrites(sql: Sql, rows: number, now: number): void {
  const { day, rowsWritten } = readQuota(sql, now)
  writeMeta(sql, 'write_day', String(day))
  writeMeta(sql, 'rows_written', String(rowsWritten + rows))
}
