import { describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import type { browser as Chrome } from 'wxt/browser'
import type { IdMap } from '../ids/id-map'
import { executeTabCommand } from './tab-executor'

const ids = (table: Record<string, number>): IdMap => ({
  uuidFor: () => Promise.resolve(''),
  peek: () => Promise.resolve(undefined),
  chromeIdFor: (_kind, uuid) => Promise.resolve(table[uuid]),
  remap: () => Promise.resolve(),
  forget: () => Promise.resolve(),
})

const deps = (table: Record<string, number>) => ({
  browser: fakeBrowser as unknown as typeof Chrome,
  ids: ids(table),
})

describe('executeTabCommand', () => {
  it('closes a tab', async () => {
    const tab = await fakeBrowser.tabs.create({ url: 'https://example.com/' })
    await executeTabCommand(
      { kind: 'tab.close', tabId: 't1' },
      deps({ t1: tab.id! }),
    )

    const remaining = await fakeBrowser.tabs.query({})
    expect(remaining.map((open) => open.id)).not.toContain(tab.id)
  })

  it('treats a tab that is already gone as done', async () => {
    await expect(
      executeTabCommand({ kind: 'tab.close', tabId: 't1' }, deps({ t1: 4242 })),
    ).resolves.toBe(true)
  })

  it('says nothing about a tab it has never heard of', async () => {
    const remove = vi.spyOn(fakeBrowser.tabs, 'remove')
    await executeTabCommand({ kind: 'tab.close', tabId: 'unknown' }, deps({}))

    expect(remove).not.toHaveBeenCalled()
  })

  it('activates a tab and brings its window forward', async () => {
    const tab = await fakeBrowser.tabs.create({ url: 'https://example.com/' })
    const focus = vi.spyOn(fakeBrowser.windows, 'update')

    await executeTabCommand(
      { kind: 'tab.activate', tabId: 't1' },
      deps({ t1: tab.id! }),
    )

    expect((await fakeBrowser.tabs.get(tab.id!)).active).toBe(true)
    expect(focus).toHaveBeenCalledWith(expect.any(Number), { focused: true })
  })

  it('closes a window', async () => {
    const created = (await fakeBrowser.windows.create({}))!
    await executeTabCommand(
      { kind: 'window.close', windowId: 'w1' },
      deps({ w1: created.id! }),
    )

    const remaining = await fakeBrowser.windows.getAll()
    expect(remaining.map((open) => open.id)).not.toContain(created.id)
  })

  it('leaves a bookmark command to the executor that owns it', async () => {
    await expect(
      executeTabCommand(
        { kind: 'bookmark.remove', bookmarkId: 'b1' },
        deps({}),
      ),
    ).resolves.toBe(false)
  })
})
