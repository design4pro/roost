import { describe, expect, it } from 'vitest'
import { SCENARIOS } from '#/shared/protocol/fixtures'
import { applyOps as applyToMirror } from '#/shared/mirror/apply'
import { emptyMirror } from '#/shared/mirror/types'
import type { Mirror } from '#/shared/mirror/types'
import type { Op, TabData, WindowData } from '#/shared/protocol/ops'
import { apply, freshHub, withSql } from '../test/hub'
import { snapshotOps } from './delta'

const TABLES = {
  device: 'devices',
  window: 'windows',
  tab: 'tabs',
  tab_group: 'tab_groups',
  bookmark: 'bookmarks',
} as const

/** Which device an op is about, so a test can play the right client. */
function ownerOf(sql: SqlStorage, op: Op): string {
  switch (op.op) {
    case 'upsert':
      return op.entity === 'device' ? op.id : op.data.deviceId
    case 'window_snapshot':
      return op.data.deviceId
    case 'delete':
      // A delete carries no payload, so the only place the owner is written
      // down is the row about to go.
      return (
        sql
          .exec<{ device_id: string }>(
            `SELECT device_id FROM ${TABLES[op.entity]} WHERE id = ?`,
            op.id,
          )
          .toArray()[0]?.device_id ?? 'device-a'
      )
    default:
      return 'device-a'
  }
}

/** What the Durable Object holds, expressed as a mirror. */
const rebuild = (sql: SqlStorage): Mirror =>
  applyToMirror(emptyMirror(), snapshotOps(sql))

/** Presence is the server's, so it never matches a fixture's own value. */
const withoutDevices = (mirror: Mirror): Mirror => ({ ...mirror, devices: {} })

const tabData = (id: string, over: Partial<TabData> = {}): TabData => ({
  deviceId: 'device-a',
  windowId: 'w1',
  groupId: null,
  url: `https://example.test/${id}`,
  title: id,
  favIconUrl: null,
  pinned: false,
  discarded: false,
  active: false,
  lastAccessed: 1000,
  ...over,
})

const windowData = (
  tabOrder: string[],
  over: Partial<WindowData> = {},
): WindowData => ({
  deviceId: 'device-a',
  state: 'normal',
  bounds: null,
  focused: true,
  tabOrder,
  ...over,
})

const snapshot = (tabIds: string[]): Op => ({
  op: 'window_snapshot',
  id: 'w1',
  data: windowData(tabIds),
  groups: [],
  tabs: tabIds.map((id) => ({ id, data: tabData(id) })),
})

describe('applyOps', () => {
  it.each(SCENARIOS)(
    'agrees with the client mirror: $name',
    async ({ ops, expected }) => {
      const hub = freshHub()
      await withSql(hub, (sql) => {
        // One frame per owning device, because a device may only write its own
        // rows - which is the same constraint the real clients are under.
        for (const op of ops) apply(sql, ownerOf(sql, op), [op])
        expect(withoutDevices(rebuild(sql))).toEqual(withoutDevices(expected))
      })
    },
  )

  it('ignores a replayed frame', async () => {
    const hub = freshHub()
    await withSql(hub, (sql) => {
      const ops = [snapshot(['t1'])]
      const first = apply(sql, 'device-a', ops, { clientSeq: 7 })
      const replay = apply(sql, 'device-a', ops, { clientSeq: 7 })

      expect(first.status).toBe('applied')
      expect(replay.status).toBe('duplicate')
      expect(replay.status !== 'not_owner' && replay.rowsWritten).toBe(0)
    })
  })

  it('refuses to let a device write another device rows', async () => {
    const hub = freshHub()
    await withSql(hub, (sql) => {
      apply(sql, 'device-a', [snapshot(['t1'])])
      const result = apply(sql, 'device-b', [
        { op: 'delete', entity: 'window', id: 'w1' },
      ])
      expect(result.status).toBe('not_owner')
      expect(rebuild(sql).windows.w1).toBeDefined()
    })
  })

  it('logs nothing for a snapshot that changed nothing', async () => {
    const hub = freshHub()
    await withSql(hub, (sql) => {
      apply(sql, 'device-a', [snapshot(['t1', 't2'])])
      const again = apply(sql, 'device-a', [snapshot(['t1', 't2'])])

      // Every device re-sends a snapshot of every window when it reconnects.
      // If that woke every other device up, reconnecting would be the noisiest
      // thing in the system.
      expect(again.status !== 'not_owner' && again.ops).toEqual([])
    })
  })

  it('costs the same to re-send a snapshot of 2 tabs or of 200', async () => {
    const [small, large] = await Promise.all(
      [2, 200].map((count) =>
        withSql(freshHub(), (sql) => {
          const ids = Array.from({ length: count }, (_, i) => `t${i}`)
          apply(sql, 'device-a', [snapshot(ids)])
          const again = apply(sql, 'device-a', [snapshot(ids)])
          return again.status === 'not_owner' ? -1 : again.rowsWritten
        }),
      ),
    )
    expect(large).toBe(small)
  })

  it('costs the same to reorder 2 tabs or 200', async () => {
    // Tab order lives in one JSON column on the window row, so dragging a tab
    // is a fixed cost however long the list is. That is the whole reason the
    // order is not an index column per tab.
    const cost = (count: number) =>
      withSql(freshHub(), (sql) => {
        const ids = Array.from({ length: count }, (_, i) => `t${i}`)
        apply(sql, 'device-a', [snapshot(ids)])
        const reordered = apply(sql, 'device-a', [snapshot([...ids].reverse())])
        expect(rebuild(sql).windows.w1!.tabOrder[0]).toBe(`t${count - 1}`)
        return reordered.status === 'not_owner' ? -1 : reordered.rowsWritten
      })

    expect(await cost(200)).toBe(await cost(2))
  })

  it('closes a 200-tab window with one op in the log', async () => {
    const hub = freshHub()
    const ids = Array.from({ length: 200 }, (_, i) => `t${i}`)
    await withSql(hub, (sql) => {
      apply(sql, 'device-a', [snapshot(ids)])
      const closed = apply(sql, 'device-a', [
        { op: 'delete', entity: 'window', id: 'w1' },
      ])

      expect(closed.status !== 'not_owner' && closed.ops).toEqual([
        { op: 'delete', entity: 'window', id: 'w1' },
      ])
      expect(rebuild(sql)).toEqual(emptyMirror())
    })
  })

  it('costs the same to change one tab in a window of 3 or of 200', async () => {
    const cost = (count: number) =>
      withSql(freshHub(), (sql) => {
        const ids = Array.from({ length: count }, (_, i) => `t${i}`)
        apply(sql, 'device-a', [snapshot(ids)])
        const changed = apply(sql, 'device-a', [
          {
            op: 'window_snapshot',
            id: 'w1',
            data: windowData(ids),
            groups: [],
            tabs: ids.map((id) => ({
              id,
              data: tabData(id, id === 't1' ? { title: 'moved on' } : {}),
            })),
          },
        ])
        expect(rebuild(sql).tabs.t1!.title).toBe('moved on')
        return changed.status === 'not_owner' ? -1 : changed.rowsWritten
      })

    expect(await cost(200)).toBe(await cost(3))
  })

  it('keeps commands out of the change log and routes them instead', async () => {
    const hub = freshHub()
    await withSql(hub, (sql) => {
      const result = apply(sql, 'device-a', [
        {
          op: 'command',
          id: 'c1',
          target: 'device-b',
          body: { kind: 'tab.close', tabId: 't1' },
        },
      ])
      expect(result.status !== 'not_owner' && result.ops).toEqual([])
      expect(result.status !== 'not_owner' && result.deliveries).toEqual([
        {
          target: 'device-b',
          item: {
            id: 'c1',
            originDeviceId: 'device-a',
            body: { kind: 'tab.close', tabId: 't1' },
          },
        },
      ])
    })
  })

  it('lets only the target report a command finished', async () => {
    const hub = freshHub()
    await withSql(hub, (sql) => {
      apply(sql, 'device-a', [
        {
          op: 'command',
          id: 'c1',
          target: 'device-b',
          body: { kind: 'tab.close', tabId: 't1' },
        },
      ])
      apply(sql, 'device-c', [{ op: 'command_done', id: 'c1' }])
      const pending = () =>
        sql
          .exec<{ n: number }>(
            'SELECT COUNT(*) AS n FROM commands WHERE done_at IS NULL',
          )
          .toArray()[0]!.n

      expect(pending()).toBe(1)
      apply(sql, 'device-b', [{ op: 'command_done', id: 'c1' }])
      expect(pending()).toBe(0)
    })
  })

  it('says nothing about deleting something that is already gone', async () => {
    const hub = freshHub()
    await withSql(hub, (sql) => {
      const result = apply(sql, 'device-a', [
        { op: 'delete', entity: 'tab', id: 'never-existed' },
      ])
      expect(result.status !== 'not_owner' && result.ops).toEqual([])
    })
  })
})
