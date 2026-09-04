import type { Browser } from 'wxt/browser'
import type {
  Op,
  TabData,
  TabGroupData,
  WindowData,
} from '#/shared/protocol/ops'

/**
 * Browser objects as protocol ops.
 *
 * Pure on purpose: the ids have already been resolved by the caller, so what is
 * left is a translation that can be checked against a recorded tab without a
 * browser anywhere near it.
 */

export interface TabIds {
  windowId: string
  groupId: string | null
}

export function tabData(
  tab: Browser.tabs.Tab,
  ids: TabIds,
  deviceId: string,
): TabData {
  // Chrome's types promise these on every tab; Chrome itself omits them on
  // tabs it has not loaded, and a missing field is a frame the hub refuses.
  const live: Omit<
    Browser.tabs.Tab,
    'active' | 'discarded' | 'lastAccessed' | 'pinned'
  > & {
    active?: boolean
    discarded?: boolean
    lastAccessed?: number
    pinned?: boolean
  } = tab

  return {
    deviceId,
    windowId: ids.windowId,
    groupId: ids.groupId,
    // A restored tab holds a placeholder page that knows the real address; the
    // rest of the system should never learn that the placeholder exists.
    url: unwrapLazy(tab.url ?? tab.pendingUrl ?? ''),
    title: tab.title ?? '',
    favIconUrl: tab.favIconUrl ?? null,
    pinned: live.pinned ?? false,
    discarded: live.discarded ?? false,
    active: live.active ?? false,
    lastAccessed: live.lastAccessed ?? 0,
  }
}

export function windowData(
  window: Browser.windows.Window,
  tabOrder: string[],
  deviceId: string,
): WindowData {
  const state = (window.state ?? 'normal') as WindowData['state']
  return {
    deviceId,
    state,
    // Chrome reports a position for a maximized window too, but restoring one
    // means asking for the state, not the rectangle it happens to occupy.
    bounds:
      state === 'normal' &&
      window.left !== undefined &&
      window.top !== undefined &&
      window.width !== undefined &&
      window.height !== undefined
        ? {
            left: window.left,
            top: window.top,
            width: window.width,
            height: window.height,
          }
        : null,
    focused: window.focused,
    tabOrder,
  }
}

export function groupData(
  group: Browser.tabGroups.TabGroup,
  windowId: string,
  deviceId: string,
): TabGroupData {
  return {
    deviceId,
    windowId,
    title: group.title ?? '',
    color: group.color,
    collapsed: group.collapsed,
  }
}

/**
 * Whether a tab belongs to no group. Chrome's group ids are positive; its
 * "none" sentinel is -1, and a tab may simply not carry the field at all.
 */
export const noGroup = (groupId: number | undefined): boolean =>
  groupId === undefined || groupId < 1

/** One op describing a window and everything in it. */
export function windowSnapshot(
  id: string,
  data: WindowData,
  groups: Array<{ id: string; data: TabGroupData }>,
  tabs: Array<{ id: string; data: TabData }>,
): Op {
  return { op: 'window_snapshot', id, data, groups, tabs }
}

/**
 * The address a restored tab stands for.
 *
 * A restored window is filled with placeholder pages so that hundreds of tabs
 * do not all start loading at once. The placeholder carries the real address in
 * its query string, and that is the address the rest of the world should see -
 * otherwise every restore would replace a window's contents with links to this
 * extension.
 */
export function unwrapLazy(url: string): string {
  if (!url.startsWith('chrome-extension://') || !url.includes('/lazy.html'))
    return url

  try {
    const wrapped = new URL(url).searchParams.get('u')
    return wrapped ?? url
  } catch {
    return url
  }
}
