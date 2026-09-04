import type { Mirror } from '#/shared/mirror/types'
import { emptyMirror } from '#/shared/mirror/types'
import { applyOps } from '#/shared/mirror/apply'
import type { Op } from '#/shared/protocol/ops'
import type { Store } from '../deps'

/**
 * This browser's copy of what every device has open.
 *
 * The dashboard is a page that comes and goes; the model it renders lives here
 * instead, so opening it is instant and closing it costs nothing. Ops applied
 * here come from two places and are treated identically: what the hub sends,
 * and what this device just did - the hub does not echo a device's own changes
 * back to it, so applying them locally is what keeps the two in step.
 */

const MIRROR_KEY = 'mirror'
const SEQ_KEY = 'lastSeq'

export interface MirrorSnapshot {
  mirror: Mirror
  lastSeq: number
}

export interface MirrorStore {
  read: () => Promise<MirrorSnapshot>
  apply: (ops: Op[], seqTo?: number) => Promise<MirrorSnapshot>
  reset: () => Promise<void>
}

export function createMirrorStore(store: Store): MirrorStore {
  let current: Promise<MirrorSnapshot> | undefined

  const read = () =>
    (current ??= Promise.all([
      store.get<Mirror>(MIRROR_KEY),
      store.get<number>(SEQ_KEY),
    ]).then(([mirror, lastSeq]) => ({
      mirror: mirror ?? emptyMirror(),
      lastSeq: lastSeq ?? 0,
    })))

  return {
    read,

    async apply(ops, seqTo) {
      const previous = await read()
      const next: MirrorSnapshot = {
        mirror: applyOps(previous.mirror, ops),
        lastSeq: seqTo ?? previous.lastSeq,
      }
      current = Promise.resolve(next)

      await store.set(MIRROR_KEY, next.mirror)
      if (next.lastSeq !== previous.lastSeq) {
        // Written after the mirror, never before: a service worker killed
        // between the two writes must under-report progress, so the hub resends
        // what was already applied rather than skipping what was not.
        await store.set(SEQ_KEY, next.lastSeq)
      }
      return next
    },

    async reset() {
      current = Promise.resolve({ mirror: emptyMirror(), lastSeq: 0 })
      await store.remove(MIRROR_KEY)
      await store.remove(SEQ_KEY)
    },
  }
}
