import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import type { CopyNode } from '#/shared/protocol/ops'
import type { FakeBookmarks, FakeNode } from '#/extension/test/fake-bookmarks'
import { createFakeBookmarks } from '#/extension/test/fake-bookmarks'
import { createStore } from '../storage'
import { createAppliedRing } from '../commands/applied-ring'
import { createRouter } from '../commands/router'
import { executeBookmarkCommand } from './executor'

const DEVICE = 'device-a'

const tree = (): FakeNode => ({
  id: '0',
  title: '',
  children: [
    {
      id: '1',
      title: 'Bookmarks bar',
      folderType: 'bookmarks-bar',
      children: [],
    },
  ],
})

let bookmarks: FakeBookmarks
let browser: typeof fakeBrowser

beforeEach(() => {
  bookmarks = createFakeBookmarks(tree())
  browser = { ...fakeBrowser, bookmarks } as unknown as typeof fakeBrowser
})

const execute = (body: Parameters<typeof executeBookmarkCommand>[0]) =>
  executeBookmarkCommand(body, { browser })

const barChildren = async () =>
  (await bookmarks.getSubTree('1'))[0]!.children ?? []

describe('executeBookmarkCommand', () => {
  it('leaves a command it does not own to another executor', async () => {
    expect(await execute({ kind: 'tab.close', tabId: 'x' })).toBe(false)
  })

  it('creates a bookmark where it was asked to', async () => {
    await execute({
      kind: 'bookmark.create',
      parentId: `${DEVICE}:1`,
      index: null,
      title: 'One',
      url: 'https://one.example',
    })

    expect(await barChildren()).toMatchObject([
      { title: 'One', url: 'https://one.example' },
    ])
  })

  it('moves a bookmark to the index it was given', async () => {
    const first = await bookmarks.create({ parentId: '1', title: 'One' })
    await bookmarks.create({ parentId: '1', title: 'Two' })

    await execute({
      kind: 'bookmark.move',
      bookmarkId: `${DEVICE}:${first.id}`,
      parentId: `${DEVICE}:1`,
      index: 1,
    })

    expect((await barChildren()).map((node) => node.title)).toEqual([
      'Two',
      'One',
    ])
  })

  it('removes a folder that still has things in it', async () => {
    const folder = await bookmarks.create({ parentId: '1', title: 'Reading' })
    await bookmarks.create({ parentId: folder.id, title: 'One' })

    await execute({
      kind: 'bookmark.remove',
      bookmarkId: `${DEVICE}:${folder.id}`,
    })

    expect(await barChildren()).toEqual([])
  })

  it('treats a bookmark that is already gone as removed', async () => {
    await expect(
      execute({ kind: 'bookmark.remove', bookmarkId: `${DEVICE}:404` }),
    ).resolves.toBe(true)
  })

  it('copies a two-level folder, parents first and in order', async () => {
    await execute({ kind: 'bookmark.copy', parentId: `${DEVICE}:1`, nodes })

    const [folder] = await barChildren()
    expect(folder!.title).toBe('Reading')
    expect(folder!.children!.map((node) => node.title)).toEqual([
      'One',
      'Later',
    ])
    expect(folder!.children![1]!.children!.map((node) => node.title)).toEqual([
      'Deep',
    ])
  })
})

describe('a command that arrives twice', () => {
  it('is carried out once', async () => {
    const store = createStore(fakeBrowser.storage.local)
    const router = createRouter({
      deviceId: DEVICE,
      uuid: () => 'unused',
      ring: createAppliedRing(store),
      execute: (body) => execute(body),
      send: () => Promise.resolve(),
    })

    const item = {
      id: 'command-1',
      originDeviceId: 'device-b',
      body: {
        kind: 'bookmark.create' as const,
        parentId: `${DEVICE}:1`,
        index: null,
        title: 'One',
        url: 'https://one.example',
      },
    }

    await router.onIncoming([item])
    await router.onIncoming([item])

    expect(await barChildren()).toHaveLength(1)
  })
})

/** A folder with a bookmark and a subfolder, as `subtreeToCopy` emits it. */
const nodes: CopyNode[] = [
  { tmpId: 'folder', parentTmpId: null, title: 'Reading', url: null, index: 0 },
  {
    tmpId: 'first',
    parentTmpId: 'folder',
    title: 'One',
    url: 'https://one.example',
    index: 0,
  },
  {
    tmpId: 'nested',
    parentTmpId: 'folder',
    title: 'Later',
    url: null,
    index: 1,
  },
  {
    tmpId: 'deep',
    parentTmpId: 'nested',
    title: 'Deep',
    url: 'https://deep.example',
    index: 0,
  },
]
