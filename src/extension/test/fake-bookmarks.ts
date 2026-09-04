/**
 * An in-memory `chrome.bookmarks`.
 *
 * webext-core's fake browser does not implement bookmarks at all, and the parts
 * this project uses are the parts where order and parentage matter, so a real
 * little tree says more than a mock ever would.
 */

export interface FakeNode {
  id: string
  parentId?: string
  title: string
  url?: string
  dateAdded?: number
  folderType?: string
  syncing?: boolean
  children?: FakeNode[]
}

export interface FakeBookmarks {
  create: (args: {
    parentId?: string
    index?: number
    title?: string
    url?: string
  }) => Promise<FakeNode>
  move: (
    id: string,
    args: { parentId?: string; index?: number },
  ) => Promise<FakeNode>
  get: (id: string) => Promise<FakeNode[]>
  getTree: () => Promise<FakeNode[]>
  getSubTree: (id: string) => Promise<FakeNode[]>
  removeTree: (id: string) => Promise<void>
}

export function createFakeBookmarks(root: FakeNode): FakeBookmarks {
  let nextId = 100

  // Chrome fills `parentId` in on every node it hands out; a fixture written by
  // hand does not, and the code being tested reads it.
  const link = (node: FakeNode) => {
    for (const child of node.children ?? []) {
      child.parentId = node.id
      link(child)
    }
  }
  link(root)

  const find = (id: string, node: FakeNode = root): FakeNode | undefined => {
    if (node.id === id) return node
    for (const child of node.children ?? []) {
      const found = find(id, child)
      if (found !== undefined) return found
    }
    return undefined
  }

  const require = (id: string): FakeNode => {
    const node = find(id)
    if (node === undefined) throw new Error(`No bookmark with id ${id}`)
    return node
  }

  const detach = (id: string): FakeNode => {
    const node = require(id)
    const parent = require(node.parentId ?? root.id)
    parent.children = (parent.children ?? []).filter((child) => child.id !== id)
    return node
  }

  return {
    // Chrome's promise API rejects rather than throwing, so these are async.
    create: async (args) => {
      const parent = require(args.parentId ?? root.id)
      const node: FakeNode = {
        id: String(nextId++),
        parentId: parent.id,
        title: args.title ?? '',
        ...(args.url === undefined ? { children: [] } : { url: args.url }),
      }
      const children = (parent.children ??= [])
      children.splice(args.index ?? children.length, 0, node)
      return node
    },

    move: async (id, args) => {
      const node = detach(id)
      const parent = require(args.parentId ?? node.parentId ?? root.id)
      node.parentId = parent.id
      const children = (parent.children ??= [])
      children.splice(args.index ?? children.length, 0, node)
      return node
    },

    get: async (id) => [require(id)],
    getTree: async () => [root],
    getSubTree: async (id) => [require(id)],

    removeTree: async (id) => {
      detach(id)
    },
  }
}
