import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import type { FakeBookmarks, FakeNode } from '#/extension/test/fake-bookmarks'
import { createFakeBookmarks } from '#/extension/test/fake-bookmarks'
import { flushBookmarks } from './flush'

const DEVICE = 'device-a'

const tree = (): FakeNode => ({
  id: '0',
  title: '',
  children: [
    {
      id: '1',
      title: 'Bookmarks bar',
      folderType: 'bookmarks-bar',
      children: [
        { id: '11', title: 'One', url: 'https://one.example' },
        { id: '12', title: 'Two', url: 'https://two.example' },
      ],
    },
    { id: '2', title: 'Other bookmarks', folderType: 'other', children: [] },
  ],
})

let bookmarks: FakeBookmarks
let browser: typeof fakeBrowser

beforeEach(() => {
  bookmarks = createFakeBookmarks(tree())
  browser = { ...fakeBrowser, bookmarks } as unknown as typeof fakeBrowser
})

const flush = (keys: string[], positions: Record<string, string> = {}) =>
  flushBookmarks(keys, { browser, deviceId: DEVICE, positions })

describe('flushBookmarks', () => {
  it('ignores the keys that belong to windows and tabs', async () => {
    expect(await flush(['window:7', 'tab:8', 'delete:window:7'])).toEqual([])
  })

  it('describes the whole tree for the key that means all of it', async () => {
    const ops = await flush(['bookmarks'])
    expect(ops.map((op) => op.op === 'upsert' && op.id)).toEqual([
      `${DEVICE}:1`,
      `${DEVICE}:2`,
      `${DEVICE}:11`,
      `${DEVICE}:12`,
    ])
  })

  it('describes one folder without touching the others', async () => {
    const ops = await flush(['folder:1'])
    expect(ops.map((op) => op.op === 'upsert' && op.id)).toEqual([
      `${DEVICE}:11`,
      `${DEVICE}:12`,
    ])
  })

  it('reads a changed bookmark back through its folder', async () => {
    const ops = await flush(['bookmark:11'])
    expect(ops.map((op) => op.op === 'upsert' && op.id)).toEqual([
      `${DEVICE}:11`,
      `${DEVICE}:12`,
    ])
  })

  it('deletes a bookmark Chrome no longer knows about', async () => {
    await bookmarks.removeTree('11')
    expect(await flush(['bookmark:11'])).toEqual([
      { op: 'delete', entity: 'bookmark', id: `${DEVICE}:11` },
    ])
  })

  it('gives the roots no parent of their own', async () => {
    const ops = await flush(['folder:0'])
    const bar = ops.find((op) => op.op === 'upsert' && op.id === `${DEVICE}:1`)
    expect(bar).toMatchObject({ data: { parentId: null } })
  })
})
