import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { browser } from 'wxt/browser'
import type { Store } from '../deps'
import { createIdMap } from '../ids/id-map'
import { flush } from './flush'

const memoryStore = (): Store => {
  const data = new Map<string, unknown>()
  return {
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
}

let deps: Parameters<typeof flush>[1]

beforeEach(() => {
  let n = 0
  deps = {
    browser,
    ids: createIdMap(memoryStore(), () => `id-${++n}`),
    deviceId: 'device-a',
  }
})

const openWindow = async (urls: string[]) => {
  const window = await fakeBrowser.windows.create({})
  const windowId = window?.id as number
  for (const url of urls) {
    await fakeBrowser.tabs.create({ windowId, url })
  }
  return windowId
}

describe('reading the browser for dirty keys', () => {
  it('describes a window and everything in it', async () => {
    const windowId = await openWindow(['https://a.test/', 'https://b.test/'])

    const [op] = await flush([`window:${windowId}`], deps)

    expect(op).toMatchObject({ op: 'window_snapshot' })
    const snapshot = op as Extract<typeof op, { op: 'window_snapshot' }>
    expect(snapshot.tabs.map((tab) => tab.data.url)).toEqual([
      'https://a.test/',
      'https://b.test/',
    ])
    // The order is the window's, not each tab's: dragging a tab in a window of
    // two hundred has to stay a single row.
    expect(snapshot.data.tabOrder).toEqual(snapshot.tabs.map((tab) => tab.id))
  })

  it('describes a single tab on its own', async () => {
    const windowId = await openWindow(['https://a.test/'])
    const [tab] = await fakeBrowser.tabs.query({ windowId })

    const ops = await flush([`tab:${tab!.id}`], deps)
    expect(ops).toEqual([
      expect.objectContaining({
        op: 'upsert',
        entity: 'tab',
        data: expect.objectContaining({ url: 'https://a.test/' }),
      }),
    ])
  })

  it('does not describe a tab twice when its window is being read', async () => {
    const windowId = await openWindow(['https://a.test/'])
    const [tab] = await fakeBrowser.tabs.query({ windowId })

    const ops = await flush([`window:${windowId}`, `tab:${tab!.id}`], deps)
    expect(ops).toHaveLength(1)
  })

  it('reports a window that is gone and forgets its id', async () => {
    const windowId = await openWindow(['https://a.test/'])
    await flush([`window:${windowId}`], deps)
    const id = await deps.ids.peek('window', windowId)
    await fakeBrowser.windows.remove(windowId)

    expect(await flush([`delete:window:${windowId}`], deps)).toEqual([
      { op: 'delete', entity: 'window', id },
    ])
    expect(await deps.ids.peek('window', windowId)).toBeUndefined()
  })

  it('says nothing about a window it never reported', async () => {
    expect(await flush(['delete:window:404'], deps)).toEqual([])
  })

  it('says nothing about a tab that closed before it was read', async () => {
    // Between the event and the flush the tab may be gone; that is the normal
    // case for a burst of activity, not an error.
    expect(await flush(['tab:404', 'window:404'], deps)).toEqual([])
  })

  it('shows the real address behind a restored placeholder', async () => {
    const windowId = await openWindow([
      'chrome-extension://abc/lazy.html?u=https%3A%2F%2Freal.test%2F&t=Real',
    ])

    const [op] = await flush([`window:${windowId}`], deps)
    const snapshot = op as Extract<typeof op, { op: 'window_snapshot' }>
    expect(snapshot.tabs[0]?.data.url).toBe('https://real.test/')
  })

  it('gives a tab the same id every time it is read', async () => {
    const windowId = await openWindow(['https://a.test/'])
    const first = await flush([`window:${windowId}`], deps)
    const second = await flush([`window:${windowId}`], deps)

    expect(first).toEqual(second)
  })
})
