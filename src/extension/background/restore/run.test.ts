import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import type { browser as Chrome } from 'wxt/browser'
import type { TabData, WindowData } from '#/shared/protocol/ops'
import type { Store } from '../deps'
import { planRestore } from './plan'
import { resumePending, runRestore } from './run'

const LAZY = 'chrome-extension://abc/lazy.html'

// Captured once: taking it inside a test would capture the previous stub.
const createWindow = fakeBrowser.windows.create.bind(fakeBrowser.windows)

const memoryStore = (): Store => {
  const values = new Map<string, unknown>()
  return {
    get: <T>(key: string) => Promise.resolve(values.get(key) as T | undefined),
    set: (key, value) => {
      values.set(key, value)
      return Promise.resolve()
    },
    remove: (key) => {
      values.delete(key)
      return Promise.resolve()
    },
  }
}

const tab = (index: number, extra: Partial<TabData> = {}): TabData => ({
  deviceId: 'other',
  windowId: 'w1',
  groupId: null,
  url: `https://example.com/${index}`,
  title: `Page ${index}`,
  favIconUrl: null,
  pinned: false,
  discarded: false,
  active: false,
  lastAccessed: 0,
  ...extra,
})

const window: WindowData = {
  deviceId: 'other',
  state: 'normal',
  bounds: null,
  focused: false,
  tabOrder: [],
}

const plan = (count: number) =>
  planRestore(
    window,
    Array.from({ length: count }, (_unused, i) => tab(i)),
    {},
    LAZY,
  )!

describe('runRestore', () => {
  let session: Store

  beforeEach(() => {
    session = memoryStore()
    vi.spyOn(fakeBrowser.tabs, 'group').mockResolvedValue(1 as never)

    // The fake browser opens a window without the tab the URL asks for, and
    // the resume logic counts tabs, so the first one has to be there.
    vi.spyOn(fakeBrowser.windows, 'create').mockImplementation(async (info) => {
      const created = await createWindow(info)
      const [url] = (info?.url as string[] | undefined) ?? []
      await fakeBrowser.tabs.create({ windowId: created?.id, url })
      return created
    })
  })

  const deps = (
    onFinished = vi.fn().mockResolvedValue(undefined),
    onStarted = vi.fn().mockResolvedValue(undefined),
  ) => ({
    browser: fakeBrowser as unknown as typeof Chrome,
    session,
    onStarted,
    onFinished,
  })

  it('creates the window and fills it with placeholders', async () => {
    const onFinished = vi.fn().mockResolvedValue(undefined)
    const onStarted = vi.fn().mockResolvedValue(undefined)
    const windowId = await runRestore(
      'w1',
      plan(25),
      deps(onFinished, onStarted),
    )

    const tabs = await fakeBrowser.tabs.query({ windowId })
    expect(tabs).toHaveLength(25)
    expect(tabs[0]?.url).toBe('https://example.com/0')
    expect(tabs[1]?.url).toContain(LAZY)
    expect(onFinished).toHaveBeenCalledWith(windowId)
    // Announced before the tabs are made, or capture would report them back.
    expect(onStarted).toHaveBeenCalledWith(windowId)
    expect(onStarted.mock.invocationCallOrder[0]).toBeLessThan(
      onFinished.mock.invocationCallOrder[0]!,
    )
  })

  it('leaves nothing behind to resume once it is done', async () => {
    const windowId = await runRestore('w1', plan(12), deps())

    await resumePending(deps())
    expect(await fakeBrowser.tabs.query({ windowId })).toHaveLength(12)
  })

  it('finishes a restore the worker was stopped in the middle of', async () => {
    const created = await fakeBrowser.windows.create({
      url: ['https://example.com/0'],
    })
    const windowId = created!.id!
    await session.set('restore.activeWindows', [windowId])
    await session.set('restore.jobs', [
      { sourceWindowId: 'w1', plan: plan(25), windowId },
    ])

    await resumePending(deps())
    expect(await fakeBrowser.tabs.query({ windowId })).toHaveLength(25)
  })

  it('creates no duplicates when a resume runs twice', async () => {
    const windowId = await runRestore('w1', plan(25), deps())
    await resumePending(deps())

    expect(await fakeBrowser.tabs.query({ windowId })).toHaveLength(25)
  })

  it('gives up on a window the user closed', async () => {
    await session.set('restore.jobs', [
      { sourceWindowId: 'w1', plan: plan(25), windowId: 9999 },
    ])

    await resumePending(deps())
    expect(await session.get('restore.jobs')).toEqual([])
  })
})
