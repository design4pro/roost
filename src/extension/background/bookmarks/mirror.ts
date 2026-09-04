import type { Mirror } from '#/shared/mirror/types'
import type {
  BookmarkData,
  BookmarkRootKind,
  CopyNode,
  Op,
} from '#/shared/protocol/ops'
import { keyBetween } from '#/shared/fractional'

/**
 * Chrome's bookmark tree, as ops.
 *
 * One mirror per browser rather than one merged tree (see ADR 0002): the two
 * browsers already have Google Sync between them if the user wants that, and
 * merging would mean deciding which of two divergent trees is right. Ids are
 * therefore scoped by device, and a bookmark from another browser is something
 * you copy, never something that appears in yours by itself.
 *
 * Roots are classified by `folderType`, never by the ids '1' and '2': since
 * Chrome 134 a profile being migrated to account bookmarks can hold two bars
 * and two "other" folders at once, and the legacy ids only name one of each.
 */

/** The shape this module needs from `chrome.bookmarks`, and no more. */
export interface ChromeNode {
  id: string
  parentId?: string
  title: string
  url?: string
  dateAdded?: number
  folderType?: string
  syncing?: boolean
  children?: ChromeNode[]
}

const ROOT_KINDS: Record<string, BookmarkRootKind> = {
  'bookmarks-bar': 'bookmarks-bar',
  other: 'other',
  mobile: 'mobile',
  managed: 'managed',
}

/** Bookmarks are shared with nobody, so their ids carry their owner. */
export const bookmarkId = (deviceId: string, chromeId: string) =>
  `${deviceId}:${chromeId}`

export function rootKindOf(node: ChromeNode): BookmarkRootKind | null {
  return node.folderType === undefined
    ? null
    : (ROOT_KINDS[node.folderType] ?? null)
}

/**
 * Positions for one folder's children, reusing the keys that still hold.
 *
 * Recomputing every key would rewrite a row per sibling on every reorder, and
 * the free plan counts rows. A key is kept whenever it is still above the one
 * before it; only the ones that moved get a new key between their neighbours.
 */
export function assignPositions(
  children: ReadonlyArray<{ position: string | null }>,
): string[] {
  const out: string[] = []
  let previous: string | null = null

  children.forEach((child, index) => {
    const above = (candidate: string | null) =>
      candidate !== null && (previous === null || candidate > previous)

    if (above(child.position)) {
      out.push(child.position as string)
      previous = child.position
      return
    }

    const next =
      children
        .slice(index + 1)
        .map((sibling) => sibling.position)
        .find(above) ?? null

    const minted = keyBetween(previous, next)
    out.push(minted)
    previous = minted
  })

  return out
}

export interface MirrorContext {
  deviceId: string
  /** Positions this device has already reported, by bookmark id. */
  positions: Readonly<Record<string, string>>
}

/** One folder's children as upserts. Roots have no parent of their own. */
export function folderToOps(
  children: readonly ChromeNode[],
  parentChromeId: string | null,
  context: MirrorContext,
): Op[] {
  const positions = assignPositions(
    children.map((child) => ({
      position:
        context.positions[bookmarkId(context.deviceId, child.id)] ?? null,
    })),
  )

  return children.map((child, index) => ({
    op: 'upsert' as const,
    entity: 'bookmark' as const,
    id: bookmarkId(context.deviceId, child.id),
    data: nodeData(child, parentChromeId, positions[index]!, context.deviceId),
  }))
}

/** The whole tree, parents before children. */
export function treeToOps(root: ChromeNode, context: MirrorContext): Op[] {
  // Chrome's own root is a container with no meaning of its own; what the user
  // calls their bookmarks are its children.
  return walk(root.children ?? [], null, context)
}

function walk(
  children: readonly ChromeNode[],
  parentChromeId: string | null,
  context: MirrorContext,
): Op[] {
  const ops = folderToOps(children, parentChromeId, context)

  for (const child of children) {
    if (child.children !== undefined) {
      ops.push(...walk(child.children, child.id, context))
    }
  }

  return ops
}

export function nodeData(
  node: ChromeNode,
  parentChromeId: string | null,
  position: string,
  deviceId: string,
): BookmarkData {
  return {
    deviceId,
    parentId:
      parentChromeId === null ? null : bookmarkId(deviceId, parentChromeId),
    position,
    title: node.title,
    url: node.url ?? null,
    isFolder: node.url === undefined,
    rootKind: rootKindOf(node),
    dateAdded: node.dateAdded ?? 0,
  }
}

/**
 * A folder from any device, flattened into the nodes that recreate it here.
 *
 * Parents come before their children and refer to each other by temporary ids,
 * because the real ids only exist once the executor has created them.
 */
export function subtreeToCopy(mirror: Mirror, rootId: string): CopyNode[] {
  const root = mirror.bookmarks[rootId]
  if (root === undefined) return []

  const childrenOf = (parentId: string) =>
    Object.entries(mirror.bookmarks)
      .filter(([, child]) => child.parentId === parentId)
      .sort(([, a], [, b]) => a.position.localeCompare(b.position))

  const nodes: CopyNode[] = []

  const push = (
    id: string,
    data: BookmarkData,
    parentTmpId: string | null,
    index: number,
  ) => {
    nodes.push({
      tmpId: id,
      parentTmpId,
      title: data.title,
      url: data.url,
      index,
    })

    childrenOf(id).forEach(([childId, child], childIndex) => {
      push(childId, child, id, childIndex)
    })
  }

  push(rootId, root, null, 0)
  return nodes
}
