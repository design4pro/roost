import { describe, expect, it } from 'vitest'
import type { Mirror } from '#/shared/mirror/types'
import { emptyMirror } from '#/shared/mirror/types'
import { buildRows, buildTree } from './select'

const tab = (
  windowId: string,
  title: string,
  groupId: string | null = null,
) => ({
  deviceId: 'device-a',
  windowId,
  groupId,
  url: `https://${title.toLowerCase()}.test/`,
  title,
  favIconUrl: null,
  pinned: false,
  discarded: false,
  active: false,
  lastAccessed: 1,
})

const mirror = (): Mirror => ({
  ...emptyMirror(),
  devices: {
    'device-a': {
      name: 'Chrome',
      os: 'macOS',
      browserVersion: '140',
      extensionVersion: '0.1.0',
      online: true,
      lastSeen: 1,
    },
    'device-b': {
      name: 'Canary',
      os: 'macOS',
      browserVersion: '141',
      extensionVersion: '0.1.0',
      online: false,
      lastSeen: 1,
    },
  },
  windows: {
    w1: {
      deviceId: 'device-a',
      state: 'normal',
      bounds: null,
      focused: true,
      tabOrder: ['t1', 't2', 't3'],
    },
  },
  tabGroups: {
    g1: {
      deviceId: 'device-a',
      windowId: 'w1',
      title: 'Reading',
      color: 'blue',
      collapsed: false,
    },
  },
  tabs: {
    t1: tab('w1', 'Alpha'),
    t2: tab('w1', 'Beta', 'g1'),
    t3: tab('w1', 'Gamma', 'g1'),
  },
})

const selection = { deviceId: 'device-a', kind: 'window' as const, id: 'w1' }

describe('the sidebar tree', () => {
  it('lists devices and marks which one is this browser', () => {
    const nodes = buildTree(mirror(), 'device-a', new Set())
    expect(nodes.map((node) => [node.label, node.kind])).toEqual([
      ['Canary', 'device'],
      ['Chrome', 'device'],
    ])
    expect(nodes.find((node) => node.label === 'Chrome')).toMatchObject({
      local: true,
      online: true,
    })
  })

  it('shows the windows of a device only when it is expanded', () => {
    expect(buildTree(mirror(), 'device-a', new Set(['device-a']))).toHaveLength(
      3,
    )
  })

  it('names a window after the tab it is showing', () => {
    const nodes = buildTree(mirror(), 'device-a', new Set(['device-a']))
    expect(nodes.at(-1)).toMatchObject({ label: 'Alpha', tabCount: 3 })
  })
})

describe('the tab list', () => {
  it('follows the order the window itself keeps', () => {
    const rows = buildRows(mirror(), selection, '')
    expect(
      rows.filter((row) => row.kind === 'tab').map((row) => row.id),
    ).toEqual(['t1', 't2', 't3'])
  })

  it('puts a header before the first tab of a group and not before the rest', () => {
    const rows = buildRows(mirror(), selection, '')
    expect(rows.map((row) => row.kind)).toEqual(['tab', 'group', 'tab', 'tab'])
  })

  it('filters within the selected window', () => {
    const rows = buildRows(mirror(), selection, 'bet')
    expect(
      rows.filter((row) => row.kind === 'tab').map((row) => row.id),
    ).toEqual(['t2'])
  })

  it('matches the address as well as the title', () => {
    expect(buildRows(mirror(), selection, 'gamma.test')).toHaveLength(2)
  })

  it('searches every device when nothing is selected', () => {
    const rows = buildRows(mirror(), null, 'alpha')
    expect(rows).toEqual([
      expect.objectContaining({ id: 't1', context: { deviceLabel: 'Chrome' } }),
    ])
  })

  it('shows nothing at all until something is selected or typed', () => {
    // Every tab of every device in one list is not a view anyone reads.
    expect(buildRows(mirror(), null, '')).toEqual([])
  })

  it('survives a window that has just been closed', () => {
    expect(buildRows(mirror(), { ...selection, id: 'gone' }, '')).toEqual([])
  })

  it('skips tabs the mirror has not caught up with', () => {
    const stale = mirror()
    delete stale.tabs.t2
    expect(buildRows(stale, selection, '').map((row) => row.id)).toEqual([
      't1',
      'g1',
      't3',
    ])
  })
})

const bookmark = (
  partial: Partial<Mirror['bookmarks'][string]>,
): Mirror['bookmarks'][string] => ({
  deviceId: 'device-a',
  parentId: null,
  position: 'n',
  title: '',
  url: null,
  isFolder: false,
  rootKind: null,
  dateAdded: 0,
  ...partial,
})

/** A bar with a link and a folder, and one link inside that folder. */
const withBookmarks = (): Mirror => ({
  ...mirror(),
  bookmarks: {
    bar: bookmark({
      title: 'Bookmarks bar',
      isFolder: true,
      rootKind: 'bookmarks-bar',
      position: 'b',
    }),
    other: bookmark({
      title: 'Other bookmarks',
      isFolder: true,
      rootKind: 'other',
      position: 'w',
    }),
    link: bookmark({
      title: 'Alpha docs',
      url: 'https://alpha.test/docs',
      parentId: 'bar',
      position: 'b',
    }),
    reading: bookmark({
      title: 'Reading',
      isFolder: true,
      parentId: 'bar',
      position: 'n',
    }),
    later: bookmark({
      title: 'Later',
      url: 'https://later.test/',
      parentId: 'reading',
      position: 'b',
    }),
  },
})

describe('bookmarks in the sidebar', () => {
  const expandedDevice = new Set(['device-a'])

  it('hangs the roots under the device that owns them', () => {
    const nodes = buildTree(withBookmarks(), 'device-a', expandedDevice)
    expect(
      nodes.filter((node) => node.kind === 'folder').map((node) => node.label),
    ).toEqual(['Bookmarks bar', 'Other bookmarks'])
  })

  it('opens a folder only when the user asked for it', () => {
    const closed = buildTree(withBookmarks(), 'device-a', expandedDevice)
    const open = buildTree(
      withBookmarks(),
      'device-a',
      new Set(['device-a', 'bar']),
    )
    expect(closed.filter((node) => node.kind === 'folder')).toHaveLength(2)
    expect(
      open.filter((node) => node.kind === 'folder').map((node) => node.label),
    ).toEqual(['Bookmarks bar', 'Reading', 'Other bookmarks'])
  })

  it('marks as expandable only a folder with folders in it', () => {
    const nodes = buildTree(withBookmarks(), 'device-a', expandedDevice)
    expect(nodes.filter((node) => node.kind === 'folder')).toMatchObject([
      { label: 'Bookmarks bar', expandable: true },
      { label: 'Other bookmarks', expandable: false },
    ])
  })
})

describe('the bookmark list', () => {
  const folder = { deviceId: 'device-a', kind: 'folder' as const, id: 'bar' }

  it('lists a folder in the order its keys put it', () => {
    expect(buildRows(withBookmarks(), folder, '').map((row) => row.id)).toEqual(
      ['link', 'reading'],
    )
  })

  it('filters within the selected folder', () => {
    expect(
      buildRows(withBookmarks(), folder, 'read').map((row) => row.id),
    ).toEqual(['reading'])
  })

  it('searches bookmarks as well as tabs when nothing is selected', () => {
    expect(
      buildRows(withBookmarks(), null, 'alpha').map((row) => row.id),
    ).toEqual(['t1', 'link'])
  })
})
