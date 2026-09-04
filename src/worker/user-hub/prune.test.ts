import { describe, expect, it } from 'vitest'
import type { Op } from '#/shared/protocol/ops'
import { apply, freshHub, withSql } from '../test/hub'
import { logStartsAt, prune } from './prune'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000

const del = (id: string): Op => ({ op: 'delete', entity: 'tab', id })

const upsertTab = (id: string): Op => ({
  op: 'upsert',
  entity: 'tab',
  id,
  data: {
    deviceId: 'device-a',
    windowId: 'w1',
    groupId: null,
    url: `https://example.test/${id}`,
    title: id,
    favIconUrl: null,
    pinned: false,
    discarded: false,
    active: false,
    lastAccessed: 1,
  },
})

const changeCount = (sql: SqlStorage) =>
  sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM changes').toArray()[0]!.n

describe('prune', () => {
  it('drops changes older than the retention window and records where the log now starts', async () => {
    await withSql(freshHub(), (sql) => {
      apply(sql, 'device-a', [upsertTab('t1')], { now: NOW - 30 * DAY_MS })
      apply(sql, 'device-a', [upsertTab('t2')], { now: NOW })

      prune(sql, NOW)

      expect(changeCount(sql)).toBe(1)
      // Without this the hub would offer a delta from a point it can no longer
      // reach, and the client would silently miss everything before it.
      expect(logStartsAt(sql)).toBe(1)
    })
  })

  it('is a no-op the second time', async () => {
    await withSql(freshHub(), (sql) => {
      apply(sql, 'device-a', [upsertTab('t1')], { now: NOW - 30 * DAY_MS })
      prune(sql, NOW)
      const after = prune(sql, NOW)

      // An alarm that failed part-way through fires again. Running twice must
      // cost nothing and change nothing.
      expect(after.rowsWritten).toBe(0)
      expect(logStartsAt(sql)).toBe(1)
    })
  })

  it('keeps commands until they are done and stale', async () => {
    await withSql(freshHub(), (sql) => {
      apply(
        sql,
        'device-a',
        [
          {
            op: 'command',
            id: 'c1',
            target: 'device-b',
            body: { kind: 'tab.close', tabId: 't1' },
          },
        ],
        { now: NOW - 30 * DAY_MS },
      )
      const remaining = () =>
        sql
          .exec<{ n: number }>('SELECT COUNT(*) AS n FROM commands')
          .toArray()[0]!.n

      prune(sql, NOW)
      expect(remaining()).toBe(1)

      apply(sql, 'device-b', [{ op: 'command_done', id: 'c1' }], {
        now: NOW - 30 * DAY_MS,
      })
      prune(sql, NOW)
      expect(remaining()).toBe(0)
    })
  })

  it('leaves a young log alone', async () => {
    await withSql(freshHub(), (sql) => {
      apply(sql, 'device-a', [upsertTab('t1'), del('t1')], { now: NOW })
      prune(sql, NOW)
      expect(changeCount(sql)).toBe(2)
      expect(logStartsAt(sql)).toBe(0)
    })
  })
})
