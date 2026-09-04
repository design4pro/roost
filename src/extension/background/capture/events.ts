import type { browser as Chrome, Browser } from 'wxt/browser'

/**
 * Everything the browser tells us, in one shape.
 *
 * The listeners are wiring and nothing else: they translate a `chrome.*`
 * callback into a value and hand it on. Every decision about what an event
 * means happens in `dirty.ts`, against these values, where it can be tested.
 */
export type CaptureEvent =
  | { type: 'tab.created'; tab: Browser.tabs.Tab }
  | {
      type: 'tab.updated'
      tabId: number
      changeInfo: Browser.tabs.OnUpdatedInfo
      tab: Browser.tabs.Tab
    }
  | {
      type: 'tab.removed'
      tabId: number
      windowId: number
      windowClosing: boolean
    }
  | { type: 'tab.moved'; tabId: number; windowId: number }
  | { type: 'tab.attached'; tabId: number; windowId: number }
  | { type: 'tab.detached'; tabId: number; windowId: number }
  | { type: 'tab.activated'; tabId: number; windowId: number }
  | { type: 'tab.replaced'; addedTabId: number; removedTabId: number }
  | { type: 'window.created'; windowId: number }
  | { type: 'window.removed'; windowId: number }
  | { type: 'window.focused'; windowId: number }
  | { type: 'group.updated'; windowId: number }
  | { type: 'group.removed'; windowId: number }
  | { type: 'bookmark.changed'; id: string }
  | {
      type: 'bookmark.moved'
      id: string
      parentId: string
      oldParentId: string
    }
  | { type: 'bookmark.removed'; id: string; parentId: string }
  | { type: 'bookmark.reordered'; parentId: string }
  | { type: 'bookmarks.import.began' }
  | { type: 'bookmarks.import.ended' }

export type Emit = (event: CaptureEvent) => void

/** Wire every listener this extension needs. Returns nothing to unsubscribe:
 * the service worker's lifetime is the subscription's lifetime. */
export function subscribe(browser: typeof Chrome, emit: Emit): void {
  browser.tabs.onCreated.addListener((tab) =>
    emit({ type: 'tab.created', tab }),
  )
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) =>
    emit({ type: 'tab.updated', tabId, changeInfo, tab }),
  )
  browser.tabs.onRemoved.addListener((tabId, info) =>
    emit({
      type: 'tab.removed',
      tabId,
      windowId: info.windowId,
      windowClosing: info.isWindowClosing,
    }),
  )
  browser.tabs.onMoved.addListener((tabId, info) =>
    emit({ type: 'tab.moved', tabId, windowId: info.windowId }),
  )
  browser.tabs.onAttached.addListener((tabId, info) =>
    emit({ type: 'tab.attached', tabId, windowId: info.newWindowId }),
  )
  browser.tabs.onDetached.addListener((tabId, info) =>
    emit({ type: 'tab.detached', tabId, windowId: info.oldWindowId }),
  )
  browser.tabs.onActivated.addListener((info) =>
    emit({ type: 'tab.activated', tabId: info.tabId, windowId: info.windowId }),
  )
  browser.tabs.onReplaced.addListener((addedTabId, removedTabId) =>
    emit({ type: 'tab.replaced', addedTabId, removedTabId }),
  )

  browser.windows.onCreated.addListener((window) => {
    if (window.id !== undefined)
      emit({ type: 'window.created', windowId: window.id })
  })
  browser.windows.onRemoved.addListener((windowId) =>
    emit({ type: 'window.removed', windowId }),
  )
  browser.windows.onFocusChanged.addListener((windowId) =>
    emit({ type: 'window.focused', windowId }),
  )

  browser.tabGroups.onUpdated.addListener((group) =>
    emit({ type: 'group.updated', windowId: group.windowId }),
  )
  browser.tabGroups.onMoved.addListener((group) =>
    emit({ type: 'group.updated', windowId: group.windowId }),
  )
  browser.tabGroups.onRemoved.addListener((group) =>
    emit({ type: 'group.removed', windowId: group.windowId }),
  )

  browser.bookmarks.onCreated.addListener((id) =>
    emit({ type: 'bookmark.changed', id }),
  )
  browser.bookmarks.onChanged.addListener((id) =>
    emit({ type: 'bookmark.changed', id }),
  )
  browser.bookmarks.onMoved.addListener((id, info) =>
    emit({
      type: 'bookmark.moved',
      id,
      parentId: info.parentId,
      oldParentId: info.oldParentId,
    }),
  )
  browser.bookmarks.onRemoved.addListener((id, info) =>
    emit({ type: 'bookmark.removed', id, parentId: info.parentId }),
  )
  browser.bookmarks.onChildrenReordered.addListener((id) =>
    emit({ type: 'bookmark.reordered', parentId: id }),
  )
  browser.bookmarks.onImportBegan.addListener(() =>
    emit({ type: 'bookmarks.import.began' }),
  )
  browser.bookmarks.onImportEnded.addListener(() =>
    emit({ type: 'bookmarks.import.ended' }),
  )
}
