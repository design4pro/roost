import type {
  BookmarkData,
  DeviceData,
  TabData,
  TabGroupData,
  WindowData,
} from '../protocol/ops'

/**
 * The replicated state, in the shape both ends read it: five id-keyed maps.
 *
 * The service worker keeps one of these in `storage.local` and the dashboard
 * renders from a copy of it. The Durable Object stores the same information in
 * SQLite and can rebuild this exact structure, which is what lets one set of
 * fixtures prove that both ends agree about what an op means.
 */
export interface Mirror {
  devices: Record<string, DeviceData>
  windows: Record<string, WindowData>
  tabs: Record<string, TabData>
  tabGroups: Record<string, TabGroupData>
  bookmarks: Record<string, BookmarkData>
}

export function emptyMirror(): Mirror {
  return { devices: {}, windows: {}, tabs: {}, tabGroups: {}, bookmarks: {} }
}
