import { describe, expect, it } from 'vitest'
import type { Op, TabData, WindowData } from '#/shared/protocol/ops'
import { apply, freshHub, withSql } from '../test/hub'
import { welcomeFrames } from './delta'
import { prune } from './prune'
import { writeMeta } from './schema'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000

const windowData = (tabOrder: string[]): WindowData => ({
  deviceId: 'device-a',
  state: 'normal',
  bounds: null,
  focused: true,
  tabOrder,
})

const tabData = (id: string, title: string): TabData => ({
  deviceId: 'device-a',
  windowId: 'w1',
  groupId: null,
  url: `https://example.test/${id}`,
  title,
  favIconUrl: null,
  pinned: false,
  discarded: false,
  active: false,
  lastAccessed: 1,
})

const snapshot = (ids: string[], title = 'a tab'): Op => ({
  op: 'window_snapshot',
  id: 'w1',
  data: windowData(ids),
  groups: [],
  tabs: ids.map((id) => ({ id, data: tabData(id, title) })),
})

describe('welcomeFrames', () => {
  it('sends the ops a client missed', async () => {
    await withSql(freshHub(), (sql) => {
      apply(sql, 'device-a', [snapshot(['t1'])], { now: NOW })
      const first = welcomeFrames(sql, 0)
      apply(sql, 'device-a', [snapshot(['t1', 't2'])], { now: NOW })

      const second = welcomeFrames(sql, first.seq)
      expect(second.mode).toBe('delta')
      expect(second.frames.flatMap((frame) => frame.ops)).toHaveLength(1)
    })
  })

  it('falls back to a snapshot when the log no longer reaches back', async () => {
    await withSql(freshHub(), (sql) => {
      apply(sql, 'device-a', [snapshot(['t1'])], { now: NOW - 30 * DAY_MS })
      apply(sql, 'device-a', [snapshot(['t1', 't2'])], { now: NOW })
      prune(sql, NOW)

      const welcome = welcomeFrames(sql, 0)
      expect(welcome.mode).toBe('snapshot')
      // A snapshot has to reproduce the state, not the history: one op per
      // window, carrying every tab it has.
      const ops = welcome.frames.flatMap((frame) => frame.ops)
      expect(ops[0]).toMatchObject({ op: 'window_snapshot', id: 'w1' })
      expect(ops.filter((op) => op.op === 'upsert')).toHaveLength(2)
    })
  })

  it('splits a large snapshot across frames', async () => {
    await withSql(freshHub(), (sql) => {
      // Enough tabs that the state cannot fit in one message. The client does
      // not care how many frames arrive, but the platform does: a frame over a
      // mebibyte is dropped, and the welcome would silently never complete.
      const ids = Array.from({ length: 4000 }, (_, i) => `t${i}`)
      apply(sql, 'device-a', [snapshot(ids, 'x'.repeat(200))])
      writeMeta(sql, 'log_starts_at', '9999')

      const welcome = welcomeFrames(sql, 0)
      expect(welcome.mode).toBe('snapshot')
      for (const frame of welcome.frames) {
        expect(JSON.stringify(frame).length).toBeLessThan(1024 * 1024)
      }
    })
  })

  it('leaves a client with nothing to do when it is up to date', async () => {
    await withSql(freshHub(), (sql) => {
      apply(sql, 'device-a', [snapshot(['t1'])])
      const welcome = welcomeFrames(sql, welcomeFrames(sql, 0).seq)
      expect(welcome.frames.flatMap((frame) => frame.ops)).toEqual([])
    })
  })
})
