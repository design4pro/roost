import { describe, expect, it } from 'vitest'
import { emptyMirror } from '#/shared/mirror/types'
import type { Mirror } from '#/shared/mirror/types'
import type { BookmarkData } from '#/shared/protocol/ops'
import type { ChromeNode } from './mirror'
import {
  assignPositions,
  bookmarkId,
  folderToOps,
  rootKindOf,
  subtreeToCopy,
  treeToOps,
} from './mirror'

const DEVICE = 'device-a'
const context = (positions: Record<string, string> = {}) => ({
  deviceId: DEVICE,
  positions,
})

/** Chrome 138 while a profile is being migrated to account bookmarks. */
const doubleRoots: ChromeNode = {
  id: '0',
  title: '',
  children: [
    {
      id: '1',
      title: 'Bookmarks bar',
      folderType: 'bookmarks-bar',
      syncing: true,
      children: [{ id: '11', title: 'Local', url: 'https://local.example' }],
    },
    { id: '2', title: 'Other bookmarks', folderType: 'other', syncing: true },
    {
      id: '3',
      title: 'Bookmarks bar',
      folderType: 'bookmarks-bar',
      syncing: false,
      children: [{ id: '31', title: 'Account', url: 'https://acct.example' }],
    },
    { id: '4', title: 'Other bookmarks', folderType: 'other', syncing: false },
  ],
}

describe('rootKindOf', () => {
  it('classifies by folderType and not by the legacy ids', () => {
    const [bar, other] = doubleRoots.children!
    expect(rootKindOf(bar!)).toBe('bookmarks-bar')
    expect(rootKindOf(other!)).toBe('other')
    expect(rootKindOf({ id: '11', title: 'Local' })).toBeNull()
  })

  it('leaves a folderType it does not know unclassified', () => {
    expect(rootKindOf({ id: '9', title: 'x', folderType: 'future' })).toBeNull()
  })
})

describe('assignPositions', () => {
  it('keeps every key when the order has not changed', () => {
    const kept = assignPositions([
      { position: 'b' },
      { position: 'n' },
      { position: 'w' },
    ])
    expect(kept).toEqual(['b', 'n', 'w'])
  })

  it('mints a key only for the child that moved', () => {
    // 'w' has been dragged to the front, so its neighbours need new keys.
    const moved = assignPositions([
      { position: 'w' },
      { position: 'b' },
      { position: 'n' },
    ])
    expect(moved[0]).toBe('w')
    expect(moved[1]).not.toBe('b')
    expect(moved[2]).not.toBe('n')
    expect(moved[1]! > moved[0]!).toBe(true)
    expect(moved[2]! > moved[1]!).toBe(true)
  })

  it('gives a new child a key between its neighbours', () => {
    const inserted = assignPositions([
      { position: 'b' },
      { position: null },
      { position: 'w' },
    ])
    expect(inserted[1]! > 'b').toBe(true)
    expect(inserted[1]! < 'w').toBe(true)
  })
})

describe('treeToOps', () => {
  const ops = treeToOps(doubleRoots, context())
  const data = (id: string) =>
    ops.find((op) => op.op === 'upsert' && op.id === bookmarkId(DEVICE, id))

  it('reports both bars of a migrating profile', () => {
    const bars = ops.filter(
      (op) =>
        op.op === 'upsert' &&
        op.entity === 'bookmark' &&
        op.data.rootKind === 'bookmarks-bar',
    )
    expect(bars).toHaveLength(2)
  })

  it('scopes ids by the device that owns the tree', () => {
    expect(data('11')).toBeDefined()
    expect(ops.every((op) => op.op !== 'upsert' || op.id.startsWith(DEVICE)))
  })

  it('hangs the roots off nothing and their children off them', () => {
    const bar = data('1')!
    const child = data('11')!
    expect((bar as { data: BookmarkData }).data.parentId).toBeNull()
    expect((child as { data: BookmarkData }).data.parentId).toBe(
      bookmarkId(DEVICE, '1'),
    )
  })

  it('marks a node without a url as a folder', () => {
    expect((data('1') as { data: BookmarkData }).data.isFolder).toBe(true)
    expect((data('11') as { data: BookmarkData }).data.isFolder).toBe(false)
  })

  it('writes nothing new when the same tree is read again', () => {
    const positions = Object.fromEntries(
      ops.flatMap((op) =>
        op.op === 'upsert' ? [[op.id, (op.data as BookmarkData).position]] : [],
      ),
    )
    const again = treeToOps(doubleRoots, context(positions))
    expect(again).toEqual(ops)
  })
})

describe('folderToOps', () => {
  it('describes only the children it was given', () => {
    const ops = folderToOps(
      [{ id: '11', title: 'Local', url: 'https://local.example' }],
      '1',
      context(),
    )
    expect(ops).toHaveLength(1)
    expect(ops[0]!.op).toBe('upsert')
  })
})

describe('subtreeToCopy', () => {
  const mirror: Mirror = {
    ...emptyMirror(),
    bookmarks: {
      folder: bookmark({ title: 'Reading', isFolder: true, position: 'b' }),
      nested: bookmark({
        title: 'Later',
        isFolder: true,
        parentId: 'folder',
        position: 'n',
      }),
      first: bookmark({
        title: 'One',
        url: 'https://one.example',
        parentId: 'folder',
        position: 'b',
      }),
      deep: bookmark({
        title: 'Deep',
        url: 'https://deep.example',
        parentId: 'nested',
        position: 'b',
      }),
    },
  }

  it('lists parents before their children', () => {
    const nodes = subtreeToCopy(mirror, 'folder')
    expect(nodes.map((node) => node.tmpId)).toEqual([
      'folder',
      'first',
      'nested',
      'deep',
    ])
  })

  it('numbers each child within its own parent', () => {
    const nodes = subtreeToCopy(mirror, 'folder')
    expect(nodes.map((node) => [node.tmpId, node.index])).toEqual([
      ['folder', 0],
      ['first', 0],
      ['nested', 1],
      ['deep', 0],
    ])
  })

  it('names the parent of every node but the root', () => {
    const nodes = subtreeToCopy(mirror, 'folder')
    expect(nodes[0]!.parentTmpId).toBeNull()
    expect(nodes[3]!.parentTmpId).toBe('nested')
  })

  it('copies nothing when the folder is not in the mirror', () => {
    expect(subtreeToCopy(mirror, 'gone')).toEqual([])
  })
})

function bookmark(partial: Partial<BookmarkData>): BookmarkData {
  return {
    deviceId: DEVICE,
    parentId: null,
    position: 'b',
    title: '',
    url: null,
    isFolder: false,
    rootKind: null,
    dateAdded: 0,
    ...partial,
  }
}
