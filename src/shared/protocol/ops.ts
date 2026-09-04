import { z } from 'zod'

/**
 * Bumped whenever a frame's meaning changes in a way an older peer would get
 * wrong. A mismatch closes the socket with 4001 rather than guessing.
 */
export const PROTOCOL_VERSION = 1

export const Entity = z.enum([
  'device',
  'window',
  'tab',
  'tab_group',
  'bookmark',
])
export type Entity = z.infer<typeof Entity>

/** Presence, written by the server rather than by the device it describes. */
export const DeviceData = z.looseObject({
  name: z.string(),
  os: z.string(),
  browserVersion: z.string(),
  extensionVersion: z.string(),
  online: z.boolean(),
  lastSeen: z.number(),
})
export type DeviceData = z.infer<typeof DeviceData>

export const WindowBounds = z.looseObject({
  left: z.number(),
  top: z.number(),
  width: z.number(),
  height: z.number(),
})
export type WindowBounds = z.infer<typeof WindowBounds>

export const WindowState = z.enum([
  'normal',
  'minimized',
  'maximized',
  'fullscreen',
])
export type WindowState = z.infer<typeof WindowState>

export const WindowData = z.looseObject({
  deviceId: z.string(),
  state: WindowState,
  /** Only meaningful for a `normal` window; Chrome ignores it for the rest. */
  bounds: WindowBounds.nullable(),
  focused: z.boolean(),
  /**
   * Tab ids in display order, as JSON on the window row rather than an index
   * column per tab. Reordering a 200-tab window is then one written row.
   */
  tabOrder: z.array(z.string()),
})
export type WindowData = z.infer<typeof WindowData>

export const TabGroupColor = z.enum([
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
])
export type TabGroupColor = z.infer<typeof TabGroupColor>

export const TabGroupData = z.looseObject({
  deviceId: z.string(),
  windowId: z.string(),
  title: z.string(),
  color: TabGroupColor,
  collapsed: z.boolean(),
})
export type TabGroupData = z.infer<typeof TabGroupData>

export const TabData = z.looseObject({
  deviceId: z.string(),
  windowId: z.string(),
  groupId: z.string().nullable(),
  url: z.string(),
  title: z.string(),
  favIconUrl: z.string().nullable(),
  pinned: z.boolean(),
  discarded: z.boolean(),
  active: z.boolean(),
  lastAccessed: z.number(),
})
export type TabData = z.infer<typeof TabData>

/**
 * Which of Chrome's permanent bookmark roots a node hangs under, classified by
 * `folderType` rather than by the legacy '1'/'2' ids - since Chrome 134 a
 * profile can have two of each while account bookmarks are being merged.
 */
export const BookmarkRootKind = z.enum([
  'bookmarks-bar',
  'other',
  'mobile',
  'managed',
])
export type BookmarkRootKind = z.infer<typeof BookmarkRootKind>

export const BookmarkData = z.looseObject({
  deviceId: z.string(),
  parentId: z.string().nullable(),
  /** Fractional index among its siblings; see src/shared/fractional.ts. */
  position: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  isFolder: z.boolean(),
  rootKind: BookmarkRootKind.nullable(),
  dateAdded: z.number(),
})
export type BookmarkData = z.infer<typeof BookmarkData>

/** One node of a subtree being copied, parents before children. */
export const CopyNode = z.looseObject({
  tmpId: z.string(),
  parentTmpId: z.string().nullable(),
  title: z.string(),
  url: z.string().nullable(),
  index: z.number(),
})
export type CopyNode = z.infer<typeof CopyNode>

/**
 * What one device asks another to do. Commands exist because a row belongs to
 * exactly one device: closing someone else's tab is a request, not a write.
 */
export const CommandBody = z.discriminatedUnion('kind', [
  z.looseObject({ kind: z.literal('tab.close'), tabId: z.string() }),
  z.looseObject({ kind: z.literal('tab.activate'), tabId: z.string() }),
  z.looseObject({ kind: z.literal('window.close'), windowId: z.string() }),
  z.looseObject({
    kind: z.literal('bookmark.create'),
    parentId: z.string(),
    index: z.number().nullable(),
    title: z.string(),
    url: z.string().nullable(),
  }),
  z.looseObject({
    kind: z.literal('bookmark.move'),
    bookmarkId: z.string(),
    parentId: z.string(),
    index: z.number(),
  }),
  z.looseObject({ kind: z.literal('bookmark.remove'), bookmarkId: z.string() }),
  z.looseObject({
    kind: z.literal('bookmark.copy'),
    parentId: z.string(),
    nodes: z.array(CopyNode),
  }),
])
export type CommandBody = z.infer<typeof CommandBody>
export type CommandKind = CommandBody['kind']

const upsert = <TEntity extends Entity, TData extends z.ZodType>(
  entity: TEntity,
  data: TData,
) =>
  z.looseObject({
    op: z.literal('upsert'),
    entity: z.literal(entity),
    id: z.string(),
    data,
  })

export const Op = z.union([
  upsert('device', DeviceData),
  upsert('window', WindowData),
  upsert('tab', TabData),
  upsert('tab_group', TabGroupData),
  upsert('bookmark', BookmarkData),
  z.looseObject({
    op: z.literal('delete'),
    entity: Entity,
    id: z.string(),
  }),
  /**
   * A window and everything in it, as it is right now. Structural changes send
   * this instead of a pile of per-tab ops, and the server diffs it against what
   * it holds - so a snapshot that changes nothing writes nothing.
   */
  z.looseObject({
    op: z.literal('window_snapshot'),
    id: z.string(),
    data: WindowData,
    groups: z.array(z.looseObject({ id: z.string(), data: TabGroupData })),
    tabs: z.array(z.looseObject({ id: z.string(), data: TabData })),
  }),
  z.looseObject({
    op: z.literal('command'),
    id: z.string(),
    target: z.string(),
    body: CommandBody,
  }),
  z.looseObject({ op: z.literal('command_done'), id: z.string() }),
])
export type Op = z.infer<typeof Op>
