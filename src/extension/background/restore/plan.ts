import type {
  TabData,
  TabGroupColor,
  TabGroupData,
  WindowBounds,
  WindowData,
  WindowState,
} from '#/shared/protocol/ops'

/**
 * Turning another browser's window into the calls that recreate it here.
 *
 * Pure, because the interesting parts are all decisions rather than effects:
 * which tab has to be loaded for real, how the rest are split up, and what
 * Chrome will quietly ignore. Two of those are Chrome's own rules -
 * `windows.create` needs at least one URL and loads whatever it is given, and
 * a window whose state is anything but `normal` ignores a position - so the
 * first tab is real, every other tab is a placeholder, and bounds and state
 * are never sent together.
 */
export const BATCH_SIZE = 10

export interface PlannedTab {
  url: string
  pinned: boolean
}

export interface PlannedGroup {
  title: string
  color: TabGroupColor
  collapsed: boolean
  /** Positions in the restored window, first tab included. */
  offsets: number[]
}

export interface RestorePlan {
  window: { url: string; state: WindowState; bounds: WindowBounds | null }
  /** Whether the window's first tab has to be pinned after it is created. */
  firstPinned: boolean
  /** Everything after the first tab, in batches Chrome can keep up with. */
  batches: PlannedTab[][]
  groups: PlannedGroup[]
}

export function planRestore(
  window: WindowData,
  tabs: readonly TabData[],
  groups: Readonly<Record<string, TabGroupData>>,
  lazyUrl: string,
): RestorePlan | null {
  const [first, ...rest] = tabs
  // A window with no tabs is not a window Chrome can be asked to make.
  if (first === undefined) return null

  const batches: PlannedTab[][] = []
  for (let i = 0; i < rest.length; i += BATCH_SIZE) {
    batches.push(
      rest.slice(i, i + BATCH_SIZE).map((tab) => ({
        url: placeholderUrl(lazyUrl, tab),
        pinned: tab.pinned,
      })),
    )
  }

  return {
    window: {
      url: first.url,
      state: window.state,
      bounds: window.state === 'normal' ? window.bounds : null,
    },
    firstPinned: first.pinned,
    batches,
    groups: planGroups(tabs, groups),
  }
}

/** A tab that shows its title and favicon without fetching anything. */
export function placeholderUrl(lazyUrl: string, tab: TabData): string {
  const query = new URLSearchParams({ u: tab.url, t: tab.title })
  if (tab.favIconUrl !== null) query.set('f', tab.favIconUrl)
  return `${lazyUrl}?${query.toString()}`
}

function planGroups(
  tabs: readonly TabData[],
  groups: Readonly<Record<string, TabGroupData>>,
): PlannedGroup[] {
  const offsets = new Map<string, number[]>()

  tabs.forEach((tab, index) => {
    if (tab.groupId === null) return
    offsets.set(tab.groupId, [...(offsets.get(tab.groupId) ?? []), index])
  })

  return [...offsets].flatMap(([id, positions]) => {
    const group = groups[id]
    // A group whose row never arrived is not worth guessing at; its tabs are
    // restored ungrouped, which is visibly incomplete rather than wrong.
    if (group === undefined) return []
    return [
      {
        title: group.title,
        color: group.color,
        collapsed: group.collapsed,
        offsets: positions,
      },
    ]
  })
}
