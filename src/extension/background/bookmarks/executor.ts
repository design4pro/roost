import type { browser as Chrome } from 'wxt/browser'
import type { CommandBody, CopyNode } from '#/shared/protocol/ops'

/**
 * Doing what another device asked, to this browser's bookmarks.
 *
 * Everything happens through `chrome.bookmarks.*` and nothing is written to the
 * mirror here: the events those calls produce are the only path back, which is
 * what keeps a copied folder identical to one the user made by hand (ADR 0002).
 */

export interface BookmarkExecutorDeps {
  browser: typeof Chrome
}

/** Whether this executor recognised the command. */
export async function executeBookmarkCommand(
  body: CommandBody,
  deps: BookmarkExecutorDeps,
): Promise<boolean> {
  switch (body.kind) {
    case 'bookmark.create':
      await deps.browser.bookmarks.create({
        parentId: chromeId(body.parentId),
        index: body.index ?? undefined,
        title: body.title,
        url: body.url ?? undefined,
      })
      return true

    case 'bookmark.move':
      await deps.browser.bookmarks.move(chromeId(body.bookmarkId), {
        parentId: chromeId(body.parentId),
        index: body.index,
      })
      return true

    case 'bookmark.remove':
      await removeNode(deps.browser, chromeId(body.bookmarkId))
      return true

    case 'bookmark.copy':
      await copy(deps.browser, chromeId(body.parentId), body.nodes)
      return true

    default:
      return false
  }
}

/**
 * A subtree, recreated parent-first.
 *
 * The nodes carry temporary ids because the real ones only exist once Chrome
 * has made them, so each created node is remembered as the parent of the ones
 * that name it.
 */
async function copy(
  browser: typeof Chrome,
  parentId: string,
  nodes: readonly CopyNode[],
): Promise<void> {
  const created = new Map<string, string>()

  // The list arrives parent-first and, within a parent, in the order the
  // siblings had; appending in that order reproduces both.
  for (const node of nodes) {
    const parent =
      node.parentTmpId === null ? parentId : created.get(node.parentTmpId)
    // A child whose parent failed has nowhere to go; the rest still land.
    if (parent === undefined) continue

    const made = await browser.bookmarks.create({
      parentId: parent,
      title: node.title,
      url: node.url ?? undefined,
    })
    created.set(node.tmpId, made.id)
  }
}

/** `remove` refuses a folder that still has anything in it. */
async function removeNode(browser: typeof Chrome, id: string): Promise<void> {
  try {
    await browser.bookmarks.removeTree(id)
  } catch {
    // Already gone, which is the state the sender was asking for.
  }
}

/** Mirror ids carry the device that owns them; Chrome knows only its own. */
function chromeId(id: string): string {
  const at = id.indexOf(':')
  return at === -1 ? id : id.slice(at + 1)
}
