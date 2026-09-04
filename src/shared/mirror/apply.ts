import type { Op } from '../protocol/ops'
import type { Mirror } from './types'

type Collection = Exclude<keyof Mirror, never>

const COLLECTION: Record<string, Collection> = {
  device: 'devices',
  window: 'windows',
  tab: 'tabs',
  tab_group: 'tabGroups',
  bookmark: 'bookmarks',
}

/**
 * Apply ops to a mirror, returning a new one. Never mutates its input: the
 * dashboard re-renders off identity, and the service worker keeps the previous
 * value around until the write to `storage.local` lands.
 *
 * `command` and `command_done` are deliberately ignored here. A command is a
 * request in flight, not replicated state, and it reaches its target down its
 * own frame rather than through the change log.
 */
export function applyOps(mirror: Mirror, ops: Iterable<Op>): Mirror {
  const next: Mirror = {
    devices: { ...mirror.devices },
    windows: { ...mirror.windows },
    tabs: { ...mirror.tabs },
    tabGroups: { ...mirror.tabGroups },
    bookmarks: { ...mirror.bookmarks },
  }

  for (const op of ops) {
    switch (op.op) {
      case 'upsert': {
        const collection = COLLECTION[op.entity]!
        // The union of data shapes is discriminated by `entity`, which the
        // schema has already checked; the map lookup loses that correlation.
        ;(next[collection] as Record<string, unknown>)[op.id] = op.data
        break
      }

      case 'delete': {
        if (op.entity === 'window') {
          deleteWindow(next, op.id)
          break
        }
        delete (next[COLLECTION[op.entity]!] as Record<string, unknown>)[op.id]
        break
      }

      case 'window_snapshot': {
        // A snapshot is the whole truth about one window, so anything that
        // claimed to be in it and is not in the snapshot is gone. Dropping it
        // here rather than trusting a separate delete is what makes a window
        // that closed while the client was offline converge on reconnect.
        for (const [id, tab] of Object.entries(next.tabs)) {
          if (tab.windowId === op.id) delete next.tabs[id]
        }
        for (const [id, group] of Object.entries(next.tabGroups)) {
          if (group.windowId === op.id) delete next.tabGroups[id]
        }
        next.windows[op.id] = op.data
        for (const group of op.groups) next.tabGroups[group.id] = group.data
        for (const tab of op.tabs) next.tabs[tab.id] = tab.data
        break
      }

      case 'command':
      case 'command_done':
        break
    }
  }

  return next
}

/** Closing a window takes its tabs and groups with it. */
function deleteWindow(mirror: Mirror, windowId: string): void {
  delete mirror.windows[windowId]
  for (const [id, tab] of Object.entries(mirror.tabs)) {
    if (tab.windowId === windowId) delete mirror.tabs[id]
  }
  for (const [id, group] of Object.entries(mirror.tabGroups)) {
    if (group.windowId === windowId) delete mirror.tabGroups[id]
  }
}
