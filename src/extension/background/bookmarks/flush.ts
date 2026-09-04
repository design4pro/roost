import type { browser as Chrome } from 'wxt/browser'
import type { Op } from '#/shared/protocol/ops'
import type { MirrorContext } from './mirror'
import { bookmarkId, folderToOps, treeToOps } from './mirror'

/**
 * Reading Chrome's bookmarks for a set of dirty keys.
 *
 * A changed bookmark is read back through its parent rather than on its own:
 * its position is a fractional key between its neighbours, so the folder is the
 * smallest thing that can be described correctly.
 */

export interface BookmarkFlushDeps {
  browser: typeof Chrome
  deviceId: string
  /** Positions this device has already reported, by bookmark id. */
  positions: Readonly<Record<string, string>>
}

export async function flushBookmarks(
  keys: string[],
  deps: BookmarkFlushDeps,
): Promise<Op[]> {
  const context: MirrorContext = {
    deviceId: deps.deviceId,
    positions: deps.positions,
  }

  const folders = new Set<string>()
  const ops: Op[] = []
  let whole = false

  for (const key of keys) {
    if (key === 'bookmarks') whole = true
    else if (key.startsWith('folder:')) folders.add(key.slice('folder:'.length))
    else if (key.startsWith('bookmark:')) {
      const chromeId = key.slice('bookmark:'.length)
      const node = (await get(() => deps.browser.bookmarks.get(chromeId)))?.[0]
      if (node === undefined) {
        ops.push({
          op: 'delete',
          entity: 'bookmark',
          id: bookmarkId(deps.deviceId, chromeId),
        })
        continue
      }
      if (node.parentId !== undefined) folders.add(node.parentId)
    }
  }

  if (whole) {
    const [root] = await deps.browser.bookmarks.getTree()
    if (root !== undefined) ops.push(...treeToOps(root, context))
    return ops
  }

  for (const chromeId of folders) {
    const [folder] = (await get(() =>
      deps.browser.bookmarks.getSubTree(chromeId),
    )) ?? [undefined]
    if (folder?.children === undefined) continue

    ops.push(
      ...folderToOps(
        folder.children,
        // Chrome's own root is not a bookmark of ours; its children are the
        // permanent folders, and they have no parent in the mirror.
        folder.id === '0' ? null : folder.id,
        context,
      ),
    )
  }

  return ops
}

/** Chrome rejects a lookup of a bookmark that has already been removed. */
async function get<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read()
  } catch {
    return undefined
  }
}
