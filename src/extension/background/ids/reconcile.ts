/**
 * Matching the windows this browser has now to the windows it had before.
 *
 * Session storage - and with it the id map - is gone after a restart, while the
 * hub still holds every window this device had open. Chrome restores those
 * windows with new numbers, so without matching them the dashboard would show
 * each of them twice: once as a ghost that will never change again, once as a
 * new window. Matching is by content, because content is all that survives.
 */

export interface LocalWindow {
  chromeId: number
  tabs: Array<{ url: string; pinned: boolean }>
}

export interface RemoteWindow {
  id: string
  tabs: Array<{ url: string; pinned: boolean }>
}

export interface Reconciliation {
  /** Restored windows that keep the id they had before the restart. */
  pairs: Array<{ chromeId: number; id: string }>
  /** Windows this browser has that the hub has never seen. */
  newLocal: number[]
  /** Windows the hub still holds that this browser did not restore. */
  staleRemote: string[]
}

/**
 * How much of a window has to be recognisable for it to count as the same
 * window. Chrome drops tabs it could not restore and the user closes a few
 * before the extension wakes up, so demanding an exact match would orphan
 * windows over a single tab; demanding too little would merge two windows that
 * happen to share a couple of pages.
 */
const MATCH_THRESHOLD = 0.5

export function matchWindows(
  local: LocalWindow[],
  remote: RemoteWindow[],
): Reconciliation {
  const pairs: Reconciliation['pairs'] = []
  const takenRemote = new Set<string>()
  const takenLocal = new Set<number>()

  // Best pair first, so a window is not claimed by a worse candidate that
  // happened to be considered earlier.
  const scored = local
    .flatMap((l) =>
      remote.map((r) => ({ l, r, score: similarity(l.tabs, r.tabs) })),
    )
    .filter((candidate) => candidate.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score)

  for (const { l, r } of scored) {
    if (takenLocal.has(l.chromeId) || takenRemote.has(r.id)) continue
    takenLocal.add(l.chromeId)
    takenRemote.add(r.id)
    pairs.push({ chromeId: l.chromeId, id: r.id })
  }

  return {
    pairs,
    newLocal: local
      .filter((l) => !takenLocal.has(l.chromeId))
      .map((l) => l.chromeId),
    staleRemote: remote.filter((r) => !takenRemote.has(r.id)).map((r) => r.id),
  }
}

/** How much of the larger window the two have in common, ignoring order. */
function similarity(a: LocalWindow['tabs'], b: RemoteWindow['tabs']): number {
  if (a.length === 0 || b.length === 0) return 0

  const remaining = b.map(fingerprint)
  let shared = 0
  for (const tab of a) {
    const index = remaining.indexOf(fingerprint(tab))
    if (index !== -1) {
      remaining.splice(index, 1)
      shared++
    }
  }
  return shared / Math.max(a.length, b.length)
}

const fingerprint = (tab: { url: string; pinned: boolean }) =>
  `${tab.pinned ? 'p' : '-'}${tab.url}`
