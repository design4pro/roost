import { describe, expect, it } from 'vitest'
import { freshHub, withSql } from '../test/hub'
import { checkBudget, readQuota, recordWrites } from './quota'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = 20_000 * DAY_MS

describe('the write budget', () => {
  it('allows a batch that fits', async () => {
    await withSql(freshHub(), (sql) => {
      recordWrites(sql, 50, NOW)
      expect(checkBudget(sql, 100, 40, NOW)).toEqual({ allowed: true })
    })
  })

  it('refuses before the batch runs, not after', async () => {
    await withSql(freshHub(), (sql) => {
      recordWrites(sql, 95, NOW)
      const verdict = checkBudget(sql, 100, 10, NOW)

      // The platform's own limit is not an error the code can catch - the write
      // just does not happen. Refusing early is the only way the client ever
      // learns that its change did not land.
      expect(verdict.allowed).toBe(false)
      expect(verdict.allowed === false && verdict.retryAt).toBe(20_001 * DAY_MS)
    })
  })

  it('starts over the next day', async () => {
    await withSql(freshHub(), (sql) => {
      recordWrites(sql, 100, NOW)
      expect(readQuota(sql, NOW + DAY_MS).rowsWritten).toBe(0)
      expect(checkBudget(sql, 100, 100, NOW + DAY_MS)).toEqual({
        allowed: true,
      })
    })
  })

  it('is off entirely when the budget is zero', async () => {
    // What a Paid-plan deployment sets: the row allowance is not the limit
    // there, and counting against a made-up one would only get in the way.
    await withSql(freshHub(), (sql) => {
      recordWrites(sql, 1_000_000, NOW)
      expect(checkBudget(sql, 0, 1000, NOW)).toEqual({ allowed: true })
    })
  })
})
