import type { CaptureEvent } from './events'

/**
 * What has to be re-read because of an event.
 *
 * Events say what changed; the keys say what to look at. Nothing here reads the
 * browser or decides what to send - that happens once per flush, against the
 * state as it is by then, which is both cheaper and more accurate than trusting
 * the payload of an event that may already be several changes out of date.
 */

/**
 * `tab:<id>` re-reads one tab, `window:<id>` re-reads a whole window (its tab
 * order, groups and every tab in it), `delete:window:<id>` reports it gone,
 * `folder:<id>` re-reads a bookmark folder's children, and `bookmarks` re-reads
 * every tree from scratch.
 */
export type DirtyKey = string

export interface CaptureContext {
  /** Windows this extension is currently filling in; their events are ours. */
  restoreActive: number[]
  /** Chrome is importing bookmarks and will tell us when it has finished. */
  bookmarksPaused: boolean
}

const NO_WINDOW = -1

export function eventToDirty(
  event: CaptureEvent,
  context: CaptureContext,
): DirtyKey[] {
  if (isBookmarkEvent(event)) {
    // An import fires thousands of events for a tree that is read once at the
    // end anyway.
    if (context.bookmarksPaused && event.type !== 'bookmarks.import.ended') {
      return []
    }
    return bookmarkKeys(event)
  }

  const window = windowOf(event)
  // A restore writes hundreds of tabs into a window that the hub already
  // describes. Reporting them back would be a conversation with ourselves.
  if (window !== undefined && context.restoreActive.includes(window)) return []

  return browserKeys(event)
}

function browserKeys(event: CaptureEvent): DirtyKey[] {
  switch (event.type) {
    case 'tab.updated':
      // Pinning or grouping a tab moves it; everything else about a tab is the
      // tab's own business and costs a single row.
      return event.changeInfo.pinned !== undefined ||
        event.changeInfo.groupId !== undefined
        ? [`window:${event.tab.windowId}`]
        : [`tab:${event.tabId}`]

    case 'tab.replaced':
      // Chrome handed the same page a new number; the id map is fixed up
      // elsewhere, and the tab itself is worth re-reading.
      return [`tab:${event.addedTabId}`]

    case 'tab.removed':
      // Closing a window closes each of its tabs first. Reporting those is
      // hundreds of rows spent describing a window that is about to be gone.
      return event.windowClosing ? [] : [`window:${event.windowId}`]

    case 'tab.created':
      return [`window:${event.tab.windowId}`]

    case 'tab.moved':
    case 'tab.attached':
    case 'tab.detached':
    case 'tab.activated':
    case 'window.created':
    case 'group.updated':
    case 'group.removed':
      return [`window:${event.windowId}`]

    case 'window.focused':
      return event.windowId === NO_WINDOW ? [] : [`window:${event.windowId}`]

    case 'window.removed':
      return [`delete:window:${event.windowId}`]

    default:
      return []
  }
}

function bookmarkKeys(event: CaptureEvent): DirtyKey[] {
  switch (event.type) {
    case 'bookmark.changed':
      return [`bookmark:${event.id}`]

    case 'bookmark.moved':
      // Both folders shift: the one it left closes the gap, the one it joined
      // makes room, and its own position is only meaningful among siblings.
      return [`folder:${event.oldParentId}`, `folder:${event.parentId}`]

    case 'bookmark.removed':
      return [`bookmark:${event.id}`, `folder:${event.parentId}`]

    case 'bookmark.reordered':
      return [`folder:${event.parentId}`]

    case 'bookmarks.import.ended':
      return ['bookmarks']

    default:
      return []
  }
}

const isBookmarkEvent = (event: CaptureEvent) =>
  event.type.startsWith('bookmark')

function windowOf(event: CaptureEvent): number | undefined {
  switch (event.type) {
    case 'tab.created':
      return event.tab.windowId
    case 'tab.updated':
      return event.tab.windowId
    case 'tab.removed':
    case 'tab.moved':
    case 'tab.attached':
    case 'tab.detached':
    case 'tab.activated':
    case 'window.created':
    case 'window.removed':
    case 'window.focused':
    case 'group.updated':
    case 'group.removed':
      return event.windowId
    default:
      return undefined
  }
}
