import type { browser as Chrome } from 'wxt/browser'
import type { Op } from '#/shared/protocol/ops'
import type { IdMap } from '../ids/id-map'
import {
  groupData,
  noGroup,
  tabData,
  windowData,
  windowSnapshot,
} from './snapshot'

/**
 * Reading the browser for a set of dirty keys and saying what changed.
 *
 * The keys say where to look and this reads what is actually there now. Between
 * the event and this call the tab may have been closed, moved or replaced; the
 * browser's answer is the truth, and anything that has since disappeared simply
 * produces no op instead of an error.
 */

export interface FlushDeps {
  browser: typeof Chrome
  ids: IdMap
  deviceId: string
}

export async function flush(keys: string[], deps: FlushDeps): Promise<Op[]> {
  const windows = new Set<number>()
  const tabs = new Set<number>()
  const deletes = new Set<number>()

  for (const key of keys) {
    const [kind, rest] = split(key)
    if (kind === 'window') windows.add(Number(rest))
    else if (kind === 'tab') tabs.add(Number(rest))
    else if (kind === 'delete') deletes.add(Number(rest.replace('window:', '')))
    // Bookmark keys are read by the bookmark mirror, not here.
  }

  const ops: Op[] = []

  for (const chromeId of deletes) {
    // A window that was never reported does not need deleting, and a window
    // that is being deleted has nothing left worth reading.
    const id = await deps.ids.peek('window', chromeId)
    windows.delete(chromeId)
    if (id === undefined) continue
    ops.push({ op: 'delete', entity: 'window', id })
    await deps.ids.forget('window', chromeId)
  }

  for (const chromeId of windows) {
    const op = await snapshotWindow(chromeId, deps)
    if (op) ops.push(op)
  }

  for (const chromeId of tabs) {
    const tab = await get(() => deps.browser.tabs.get(chromeId))
    if (!tab?.id) continue
    // The whole window is already being described, tab included.
    if (windows.has(tab.windowId)) continue

    ops.push({
      op: 'upsert',
      entity: 'tab',
      id: await deps.ids.uuidFor('tab', tab.id),
      data: tabData(tab, await tabIds(tab, deps), deps.deviceId),
    })
  }

  return ops
}

async function snapshotWindow(
  chromeId: number,
  deps: FlushDeps,
): Promise<Op | undefined> {
  const window = await get(() => deps.browser.windows.get(chromeId))
  if (!window?.id) return undefined

  const id = await deps.ids.uuidFor('window', window.id)
  const liveTabs = await deps.browser.tabs.query({ windowId: chromeId })
  const liveGroups = await groups(chromeId, deps)

  const tabs = []
  for (const tab of liveTabs) {
    if (tab.id === undefined) continue
    tabs.push({
      id: await deps.ids.uuidFor('tab', tab.id),
      data: tabData(tab, await tabIds(tab, deps), deps.deviceId),
    })
  }

  return windowSnapshot(
    id,
    // The order lives on the window rather than on each tab: dragging one tab
    // in a window of two hundred is then a single row instead of two hundred.
    windowData(
      window,
      tabs.map((tab) => tab.id),
      deps.deviceId,
    ),
    liveGroups,
    tabs,
  )
}

async function groups(chromeId: number, deps: FlushDeps) {
  const found = await get(() =>
    deps.browser.tabGroups.query({ windowId: chromeId }),
  )
  const windowId = await deps.ids.uuidFor('window', chromeId)

  const result = []
  for (const group of found ?? []) {
    result.push({
      id: await deps.ids.uuidFor('group', group.id),
      data: groupData(group, windowId, deps.deviceId),
    })
  }
  return result
}

async function tabIds(
  tab: { windowId: number; groupId?: number },
  deps: FlushDeps,
) {
  return {
    windowId: await deps.ids.uuidFor('window', tab.windowId),
    groupId: noGroup(tab.groupId)
      ? null
      : await deps.ids.uuidFor('group', tab.groupId as number),
  }
}

/** Chrome rejects a lookup of something that has already gone. */
async function get<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read()
  } catch {
    return undefined
  }
}

function split(key: string): [string, string] {
  const at = key.indexOf(':')
  return at === -1 ? [key, ''] : [key.slice(0, at), key.slice(at + 1)]
}
