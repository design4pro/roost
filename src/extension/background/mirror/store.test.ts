import { describe, expect, it } from 'vitest'
import type { Op } from '#/shared/protocol/ops'
import type { Store } from '../deps'
import { createMirrorStore } from './store'

const memoryStore = () => {
  const data = new Map<string, unknown>()
  const store: Store = {
    get: <T>(key: string) => Promise.resolve(data.get(key) as T | undefined),
    set: (key, value) => {
      data.set(key, value)
      return Promise.resolve()
    },
    remove: (key) => {
      data.delete(key)
      return Promise.resolve()
    },
  }
  return { store, data }
}

const tab = (id: string): Op => ({
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

describe('the local mirror', () => {
  it('starts empty', async () => {
    const { store } = memoryStore()
    expect(await createMirrorStore(store).read()).toEqual({
      mirror: {
        devices: {},
        windows: {},
        tabs: {},
        tabGroups: {},
        bookmarks: {},
      },
      lastSeq: 0,
    })
  })

  it('remembers what it applied across a restart', async () => {
    const { store } = memoryStore()
    await createMirrorStore(store).apply([tab('t1')], 4)

    const reopened = await createMirrorStore(store).read()
    expect(Object.keys(reopened.mirror.tabs)).toEqual(['t1'])
    expect(reopened.lastSeq).toBe(4)
  })

  it('keeps its place when applying its own changes', async () => {
    // A device's own ops are not echoed back by the hub, so they are applied
    // here without a sequence number - which must not move the hub's position.
    const { store } = memoryStore()
    const mirror = createMirrorStore(store)
    await mirror.apply([tab('t1')], 4)

    expect((await mirror.apply([tab('t2')])).lastSeq).toBe(4)
  })

  it('forgets everything when told to start over', async () => {
    const { store, data } = memoryStore()
    const mirror = createMirrorStore(store)
    await mirror.apply([tab('t1')], 4)
    await mirror.reset()

    expect(await mirror.read()).toEqual({
      mirror: {
        devices: {},
        windows: {},
        tabs: {},
        tabGroups: {},
        bookmarks: {},
      },
      lastSeq: 0,
    })
    expect(data.size).toBe(0)
  })
})
