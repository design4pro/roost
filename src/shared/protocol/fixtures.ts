import type { Op, TabData, TabGroupData, WindowData } from './ops'
import { emptyMirror } from '../mirror/types'
import type { Mirror } from '../mirror/types'

/**
 * Golden scenarios: a list of ops, and the mirror they must produce.
 *
 * Both ends replay these. The extension checks `applyOps` directly; the Durable
 * Object applies the same ops to SQLite and rebuilds a mirror out of its own
 * tables. If either drifts, one shared test file fails - which is the only way
 * to keep "what an op means" from being two implementations that agree by
 * accident.
 *
 * The expected mirrors are written out by hand rather than derived from
 * `applyOps`, because a fixture computed by the code under test proves nothing.
 */
export interface Scenario {
  name: string
  ops: Op[]
  expected: Mirror
}

const DEVICE = 'device-a'
const OTHER = 'device-b'

const tabData = (id: string, over: Partial<TabData> = {}): TabData => ({
  deviceId: DEVICE,
  windowId: 'w1',
  groupId: null,
  url: `https://example.test/${id}`,
  title: id,
  favIconUrl: null,
  pinned: false,
  discarded: false,
  active: false,
  lastAccessed: 1000,
  ...over,
})

const windowData = (
  tabOrder: string[],
  over: Partial<WindowData> = {},
): WindowData => ({
  deviceId: DEVICE,
  state: 'normal',
  bounds: { left: 0, top: 0, width: 1200, height: 800 },
  focused: true,
  tabOrder,
  ...over,
})

const groupData: TabGroupData = {
  deviceId: DEVICE,
  windowId: 'w1',
  title: 'Reading',
  color: 'blue',
  collapsed: false,
}

const deviceData = {
  name: 'Chrome on macOS',
  os: 'macOS',
  browserVersion: '141',
  extensionVersion: '0.1.0',
  online: true,
  lastSeen: 1000,
}

const bookmarkData = (deviceId: string) => ({
  deviceId,
  parentId: null,
  position: 'n',
  title: 'Bookmarks bar',
  url: null,
  isFolder: true,
  rootKind: 'bookmarks-bar' as const,
  dateAdded: 900,
})

/** A window with two tabs, the starting point of most scenarios. */
const openWindow: Op[] = [
  { op: 'upsert', entity: 'window', id: 'w1', data: windowData(['t1', 't2']) },
  { op: 'upsert', entity: 'tab', id: 't1', data: tabData('t1') },
  { op: 'upsert', entity: 'tab', id: 't2', data: tabData('t2') },
]

export const SCENARIOS: Scenario[] = [
  {
    name: 'a device, a window and two tabs',
    ops: [
      { op: 'upsert', entity: 'device', id: DEVICE, data: deviceData },
      ...openWindow,
    ],
    expected: {
      devices: { [DEVICE]: deviceData },
      windows: { w1: windowData(['t1', 't2']) },
      tabs: { t1: tabData('t1'), t2: tabData('t2') },
      tabGroups: {},
      bookmarks: {},
    },
  },
  {
    name: 'a later upsert replaces the row',
    ops: [
      ...openWindow,
      {
        op: 'upsert',
        entity: 'tab',
        id: 't1',
        data: tabData('t1', { title: 'renamed', active: true }),
      },
    ],
    expected: {
      devices: {},
      windows: { w1: windowData(['t1', 't2']) },
      tabs: {
        t1: tabData('t1', { title: 'renamed', active: true }),
        t2: tabData('t2'),
      },
      tabGroups: {},
      bookmarks: {},
    },
  },
  {
    name: 'closing a window takes its tabs and groups with it',
    ops: [
      ...openWindow,
      { op: 'upsert', entity: 'tab_group', id: 'g1', data: groupData },
      { op: 'delete', entity: 'window', id: 'w1' },
    ],
    expected: emptyMirror(),
  },
  {
    name: 'a snapshot drops tabs the window no longer has',
    ops: [
      ...openWindow,
      { op: 'upsert', entity: 'tab_group', id: 'g1', data: groupData },
      {
        op: 'window_snapshot',
        id: 'w1',
        data: windowData(['t2'], { bounds: null }),
        groups: [],
        tabs: [{ id: 't2', data: tabData('t2') }],
      },
    ],
    expected: {
      devices: {},
      windows: { w1: windowData(['t2'], { bounds: null }) },
      tabs: { t2: tabData('t2') },
      tabGroups: {},
      bookmarks: {},
    },
  },
  {
    name: 'a snapshot leaves another window alone',
    ops: [
      ...openWindow,
      {
        op: 'upsert',
        entity: 'window',
        id: 'w2',
        data: windowData(['t3'], { focused: false }),
      },
      {
        op: 'upsert',
        entity: 'tab',
        id: 't3',
        data: tabData('t3', { windowId: 'w2' }),
      },
      {
        op: 'window_snapshot',
        id: 'w1',
        data: windowData(['t1'], { state: 'maximized', bounds: null }),
        groups: [],
        tabs: [{ id: 't1', data: tabData('t1') }],
      },
    ],
    expected: {
      devices: {},
      windows: {
        w1: windowData(['t1'], { state: 'maximized', bounds: null }),
        w2: windowData(['t3'], { focused: false }),
      },
      tabs: { t1: tabData('t1'), t3: tabData('t3', { windowId: 'w2' }) },
      tabGroups: {},
      bookmarks: {},
    },
  },
  {
    name: 'bookmarks are keyed per device',
    ops: [
      {
        op: 'upsert',
        entity: 'bookmark',
        id: `${DEVICE}:1`,
        data: bookmarkData(DEVICE),
      },
      {
        op: 'upsert',
        entity: 'bookmark',
        id: `${OTHER}:1`,
        data: bookmarkData(OTHER),
      },
      { op: 'delete', entity: 'bookmark', id: `${OTHER}:1` },
    ],
    expected: {
      devices: {},
      windows: {},
      tabs: {},
      tabGroups: {},
      bookmarks: { [`${DEVICE}:1`]: bookmarkData(DEVICE) },
    },
  },
  {
    name: 'commands are not replicated state',
    ops: [
      ...openWindow,
      {
        op: 'command',
        id: 'c1',
        target: OTHER,
        body: { kind: 'tab.close', tabId: 't1' },
      },
      { op: 'command_done', id: 'c1' },
    ],
    expected: {
      devices: {},
      windows: { w1: windowData(['t1', 't2']) },
      tabs: { t1: tabData('t1'), t2: tabData('t2') },
      tabGroups: {},
      bookmarks: {},
    },
  },
]
