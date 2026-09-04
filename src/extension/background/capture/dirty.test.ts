import { describe, expect, it } from 'vitest'
import type { Browser } from 'wxt/browser'
import type { CaptureEvent } from './events'
import type { CaptureContext } from './dirty'
import { eventToDirty } from './dirty'

const idle: CaptureContext = { restoreActive: [], bookmarksPaused: false }

const tab = (overrides: Partial<Browser.tabs.Tab> = {}) =>
  ({
    id: 7,
    windowId: 1,
    index: 0,
    url: 'https://example.test/',
    title: 'Example',
    pinned: false,
    active: true,
    ...overrides,
  }) as Browser.tabs.Tab

const dirty = (event: CaptureEvent, context = idle) =>
  eventToDirty(event, context)

describe('turning browser events into work', () => {
  it('re-reads one tab when only that tab changed', () => {
    expect(
      dirty({
        type: 'tab.updated',
        tabId: 7,
        changeInfo: { title: 'New' },
        tab: tab(),
      }),
    ).toEqual(['tab:7'])
  })

  it('re-reads the window when a tab moved between places in it', () => {
    // Pinning and grouping both reorder the window; the tab alone does not say
    // where it ended up.
    expect(
      dirty({
        type: 'tab.updated',
        tabId: 7,
        changeInfo: { pinned: true },
        tab: tab(),
      }),
    ).toEqual(['window:1'])
    expect(
      dirty({
        type: 'tab.updated',
        tabId: 7,
        changeInfo: { groupId: 3 },
        tab: tab(),
      }),
    ).toEqual(['window:1'])
  })

  it('says nothing about tabs closing with their window', () => {
    // Chrome closes each tab before the window. Reporting them would spend
    // hundreds of rows describing a window that is about to be deleted anyway.
    expect(
      dirty({
        type: 'tab.removed',
        tabId: 7,
        windowId: 1,
        windowClosing: true,
      }),
    ).toEqual([])
    expect(
      dirty({
        type: 'tab.removed',
        tabId: 7,
        windowId: 1,
        windowClosing: false,
      }),
    ).toEqual(['window:1'])
  })

  it('reports a window that is gone', () => {
    expect(dirty({ type: 'window.removed', windowId: 1 })).toEqual([
      'delete:window:1',
    ])
  })

  it('ignores the browser losing focus entirely', () => {
    expect(dirty({ type: 'window.focused', windowId: -1 })).toEqual([])
    expect(dirty({ type: 'window.focused', windowId: 1 })).toEqual(['window:1'])
  })

  it('re-reads the tab Chrome swapped in', () => {
    expect(
      dirty({ type: 'tab.replaced', addedTabId: 9, removedTabId: 7 }),
    ).toEqual(['tab:9'])
  })

  it('stays quiet about a window it is restoring', () => {
    const restoring = { ...idle, restoreActive: [1] }
    expect(dirty({ type: 'tab.created', tab: tab() }, restoring)).toEqual([])
    expect(
      dirty({ type: 'tab.moved', tabId: 7, windowId: 1 }, restoring),
    ).toEqual([])
    expect(
      dirty({ type: 'tab.created', tab: tab({ windowId: 2 }) }, restoring),
    ).toEqual(['window:2'])
  })

  it('re-reads both folders a bookmark moved between', () => {
    expect(
      dirty({
        type: 'bookmark.moved',
        id: 'b1',
        parentId: 'f2',
        oldParentId: 'f1',
      }),
    ).toEqual(['folder:f1', 'folder:f2'])
  })

  it('re-reads the folder a bookmark left when it was deleted', () => {
    expect(
      dirty({ type: 'bookmark.removed', id: 'b1', parentId: 'f1' }),
    ).toEqual(['bookmark:b1', 'folder:f1'])
  })

  it('waits out an import and then reads everything once', () => {
    const importing = { ...idle, bookmarksPaused: true }
    expect(dirty({ type: 'bookmark.changed', id: 'b1' }, importing)).toEqual([])
    expect(dirty({ type: 'bookmarks.import.ended' }, importing)).toEqual([
      'bookmarks',
    ])
  })
})
